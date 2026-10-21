# 接入 ark-iam：本地联调指南

本文件说明 `example/main.go` 这套示例服务如何接入 ark-iam（OIDC 认证 + 只读目录 + 租户隔离），
以及本地一把跑通所需的配置、种子账号和身份/权限模型。

- 遇到 403 `WF_FORBIDDEN`，直接看 [ark-iam-troubleshooting.md](ark-iam-troubleshooting.md)。
- 种子数据脚本：[ark-iam-local-seed.sql](ark-iam-local-seed.sql)。

## 1. 组件与端口

| 组件 | 端口 | 说明 |
|---|---|---|
| ark-iam gateway | 8100 | 对外统一入口，提供 `/oidc/*`（含 discovery、authorize、token、userinfo、keys）与 `/v1/rp/directory` |
| ark-iam login-web | 4000 | 登录页，`/oidc` 反向代理到 gateway |
| easy-workflow 后端 | 8180 | `EASY_WORKFLOW_AUTH_MODE=enforce` 时校验 token |
| easy-workflow 前端 | 5173 | OIDC 授权码 + PKCE，回调 `/oidc/callback` |

`auth`（8081）、`rpapi`（8084）是 gateway 背后的服务，不必单独对外。

## 2. 一键启动

```bash
make config-ark    # 从 .env.ark-iam.example 生成 .env.ark-iam.local
# 编辑 .env.ark-iam.local，填入 ARK_DIRECTORY_API_KEY
make dev-all       # 启动 gateway + login-web + easy-workflow 前后端（Ctrl-C 一起停）
```

ark-iam 侧已在跑（只需要 easy-workflow）时：

```bash
make preflight-oidc   # 检查 8100/4000 就绪、8180/5173 空闲
make dev-oidc         # 只起 easy-workflow 前后端
```

| 目标 | 用途 |
|---|---|
| `make config-ark` | 生成本地配置文件（已 gitignore） |
| `make preflight-oidc` | 启动前端口/依赖检查 |
| `make backend-ark` / `make frontend-ark` | 分别只起后端/前端（带 OIDC 环境变量） |
| `make dev-all` | 全套一键启动，日志写 `logs/` |
| `make dev-oidc` | ark-iam 已就绪时只起 easy-workflow |

配置支持覆盖：`make dev-all ARK_GATEWAY_PORT=8100 ARK_DIRECTORY_API_KEY=xxx`，
或写进 `.env.ark-iam.local`（`KEY=value` 形式，`Makefile` 会 `-include`）。

## 3. 环境变量

后端（`Makefile` 的 `_backend-ark` 已全部注入）：

| 变量 | 值 | 作用 |
|---|---|---|
| `EASY_WORKFLOW_AUTH_MODE` | `enforce` | 所有业务请求必须带有效 token |
| `EASY_WORKFLOW_OIDC_ISSUER` | `http://localhost:8100/oidc` | 签发方 |
| `EASY_WORKFLOW_OIDC_AUDIENCE` | `workflow_web` | 必须与客户端 code 一致 |
| `EASY_WORKFLOW_OIDC_JWKS_URL` | `<issuer>/keys` | 本地验签 |
| `EASY_WORKFLOW_OIDC_USERINFO_URL` | `<issuer>/userinfo` | access token 无 `groups` 时补齐角色 |
| `EASY_WORKFLOW_DIRECTORY_*` | 见 `Makefile` | 只读目录（成员/部门/角色） |
| `EASY_WORKFLOW_SEED_EXAMPLE` | `false` | 避免每次启动重建示例流程 |
| `EASY_WORKFLOW_DEMO_AUTOFINISH` | `false` | 避免误自动审批 |

前端：

| 变量 | 值 |
|---|---|
| `VITE_OIDC_AUTHORITY` | `http://localhost:8100/oidc` |
| `VITE_OIDC_CLIENT_ID` | `workflow_web` |
| `VITE_OIDC_REDIRECT_URI` | `http://localhost:5173/oidc/callback` |
| `VITE_OIDC_SCOPE` | `openid profile email offline_access` |
| `VITE_PROXY_TARGET` | `http://127.0.0.1:8180` |

> `workflow_web` 是 public client（`token_endpoint_auth_method=none`），靠 PKCE 保证安全，
> 不要把 client secret 写进前端。

## 4. 本地种子账号

种子写在 `t-1`（客户租户，「工作流测试租户」），密码统一 `Workflow123`：

| 用户名 | 角色 | tenant_user |
|---|---|---|
| `workflow_admin` | workflow_admin | `tu-workflow-admin` |
| `workflow_designer` | workflow_designer | `tu-workflow-designer` |
| `workflow_approver` | workflow_approver | `tu-workflow-approver` |
| `workflow_viewer` | workflow_viewer | `tu-workflow-viewer` |
| `workflow_auditor` | workflow_auditor | `tu-workflow-auditor` |

其余种子内容：应用 `app-easy-workflow`、客户端 `workflow_web`、根部门 `dept-t1-root`、
目录 API Key `wf_live_test_key_2026_01`（库里只存 SHA-256）。

## 5. 身份是怎么来的

1. **验签**：`workflow/auth/jwt.go:84` 校验签名/iss/aud/exp，`identityFromClaims`（`jwt.go:354`）
   把声明映射成 `Identity`：`tenant_id`、`user_id`、`person_id`、`client_id`、`sid`、`scope`、`groups`；
   `token_usage=machine` 视为机器身份。缺 `user_id` 直接判无效。
2. **补角色**：ark-iam 的 access token **不带** `groups`（只写在 ID Token / userinfo）。
   中间件在 `groups` 为空且配置了 userinfo 时补一次（`workflow/auth/middleware.go:65`）。
   因此**改了角色不用换 token，下一次请求就生效**。
3. **判权限**：`Identity.Can` → 租户级覆盖 `wf_role_permission` 优先，否则回退
   `DefaultRolePermissions`（`workflow/auth/identity.go:178`）；`workflow_admin` 视为全权限
   （`identity.go:209`），空角色集合一律拒绝（fail-closed）。
4. **限数据**：所有查询都带 `tenant_id`，例如 `GetProcessListForTenant`
   （`workflow/engine/ProcessDefine.go:310`）。

`groups` 是**按应用裁剪**的：ark-iam 只把「本次客户端所属应用」的角色编码写进声明
（`ark-iam/backend/apps/auth/internal/core/oidcop/persistent_store.go:387-400`），
所以别的应用里的同名角色不会流进工作流的策略命名空间。

权限编码与默认角色映射：

| 角色 | 权限 |
|---|---|
| `workflow_admin` | 全部（含 `workflow.admin`、RBAC 覆盖、撤销任意实例） |
| `workflow_designer` | `def.read`、`def.write`、`def.publish`、`instance.read.own`、`task.read.own` |
| `workflow_approver` | `instance.start`、`instance.read.own`、`instance.revoke.own`、`task.read.own`、`task.act` |
| `workflow_viewer` | `instance.read.own`、`task.read.own` |
| `workflow_auditor` | `instance.read.tenant`、`audit.read`、`stats.read` |

## 6. 业务租户与平台租户

ark-iam 有两类租户：

| 类型 | 例子 | 用途 |
|---|---|---|
| `customer`（如 `tag=workflow`） | `t-1` | 业务租户，工作流的标准运行环境 |
| `platform`（`type=platform`） | `t_platform` | 平台自身（平台管理后台/租户管理后台的账号与角色） |

两者都能承载工作流，前提是该租户下有 `easy_workflow` 的订阅、角色和用户绑定；
差别只在语义和账号边界，详见 troubleshooting 文档第 4 节。

## 7. 常见现象速查

| 现象 | 位置 |
|---|---|
| 401 `WF_UNAUTHENTICATED` | 没带 `Authorization: Bearer`，或 token 过期 |
| 401 `WF_INVALID_TOKEN` | 签名/iss/aud/exp 不匹配，检查 issuer、audience、时钟偏差 |
| 503 `WF_AUTH_UNAVAILABLE` | 后端没有可用的验签器（enforce 下缺 issuer/audience 会直接启动失败） |
| 403 `WF_FORBIDDEN` | 认证通过但角色不含所需权限 → 见 [ark-iam-troubleshooting.md](ark-iam-troubleshooting.md) |
| 200 + `[]` | 权限没问题，但该租户下没有数据（数据在别的 `tenant_id`） |
| 目录接口 503 | 未配置 `EASY_WORKFLOW_DIRECTORY_*` |

## 8. 已知限制

- ark-iam 只读目录 API 没有「成员搜索 / 角色成员 / 部门成员」端点，目录代理只能做成员摘要、批量成员、部门树、角色清单。
- rpapi 的 API Key 换 token 不带 `scope` 声明，易触发 `缺少 directory.read`；本地走 `EASY_WORKFLOW_DIRECTORY_API_KEY_HEADER=true`（`x-api-key` 通道）。
- 种子账号、明文 API Key 仅限本地，不要带到生产。
