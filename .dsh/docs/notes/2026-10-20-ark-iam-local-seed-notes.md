# ark-iam 本地 Postgres 种子数据

日期：2026-10-20
目标：本地 Docker `postgres18` 的 `iam` 库，供 easy-workflow OA 联调。
脚本：`.dsh/docs/notes/2026-10-20-ark-iam-local-seed.sql`

> 仅用于本地开发/联调；生产不要使用这些测试口令和明文 API Key。

## 1. 已写入的数据

| 类型 | 值 |
|---|---|
| 租户 | `id/code = t-1`，名称「工作流测试租户」 |
| 应用 | `app-easy-workflow` / `easy_workflow` |
| OIDC 客户端 | `client-workflow-web` / `workflow_web`，public client + PKCE |
| redirect URI | `http://localhost:5173/oidc/callback`、`http://127.0.0.1:5173/oidc/callback` |
| post logout | `http://localhost:5173/`、`http://127.0.0.1:5173/` |
| 角色 | `workflow_admin`、`workflow_designer`、`workflow_approver`、`workflow_viewer`、`workflow_auditor` |
| OIDC scope | `openid profile email offline_access` |
| 目录 API Key | raw `wf_live_test_key_2026_01`（仅本地；库里只存 SHA-256） |
| 根部门 | `dept-t1-root` |

测试账号（密码均为 `Workflow123`）：

| 用户名 | 角色 | tenant_user id |
|---|---|---|
| `workflow_admin` | workflow_admin | `tu-workflow-admin` |
| `workflow_approver` | workflow_approver | `tu-workflow-approver` |
| `workflow_designer` | workflow_designer | `tu-workflow-designer` |
| `workflow_viewer` | workflow_viewer | `tu-workflow-viewer` |
| `workflow_auditor` | workflow_auditor | `tu-workflow-auditor` |

## 2. easy-workflow 启动配置

```bash
export EASY_WORKFLOW_AUTH_MODE=enforce
export EASY_WORKFLOW_OIDC_ISSUER=http://localhost:8081/oidc
export EASY_WORKFLOW_OIDC_AUDIENCE=workflow_web
export EASY_WORKFLOW_OIDC_JWKS_URL=http://localhost:8081/oidc/keys
export EASY_WORKFLOW_OIDC_USERINFO_URL=http://localhost:8081/oidc/userinfo
export EASY_WORKFLOW_SEED_EXAMPLE=false
export EASY_WORKFLOW_DEMO_AUTOFINISH=false
```

前端：

```bash
VITE_OIDC_AUTHORITY=http://localhost:8081/oidc
VITE_OIDC_CLIENT_ID=workflow_web
VITE_OIDC_REDIRECT_URI=http://localhost:5173/oidc/callback
VITE_OIDC_SCOPE=openid profile email offline_access
```

可选目录代理（ark-iam rpapi）：

```bash
export EASY_WORKFLOW_DIRECTORY_BASE_URL=http://localhost:8084/v1/rp/directory
export EASY_WORKFLOW_DIRECTORY_TOKEN_URL=http://localhost:8081/oidc/oauth/token
export EASY_WORKFLOW_DIRECTORY_API_KEY=wf_live_test_key_2026_01
export EASY_WORKFLOW_DIRECTORY_RESOURCE=rpapi
export EASY_WORKFLOW_DIRECTORY_API_KEY_HEADER=true
```

> ark-iam 的 access token 不带 `groups`（groups 在 ID Token/userinfo）；easy-workflow 在 enforce 模式下用
> `EASY_WORKFLOW_OIDC_USERINFO_URL` 补齐角色。
> rpapi 的 API Key 换 token 结果当前不带 `scope` 声明，容易触发 `缺少 directory.read`；
> 本地联调用 `EASY_WORKFLOW_DIRECTORY_API_KEY_HEADER=true` 走 rpapi 的 `x-api-key` 通道。
> 该通道已在同级 `ark-iam/backend/apps/rpapi/internal/middleware/directory.go` 做本地兼容放行。

## 3. 验证命令

```bash
# 确认租户/客户端/角色
docker exec -e PGPASSWORD=123456 postgres18 psql -U postgres -d iam -c "
SELECT t.id,t.code,t.name,a.code,ac.code,ac.redirect_uris
FROM tenant t
JOIN application a ON a.code='easy_workflow'
JOIN application_client ac ON ac.tenant_id=t.id AND ac.app_id=a.id
WHERE t.id='t-1';"

# 确认账号/角色
docker exec -e PGPASSWORD=123456 postgres18 psql -U postgres -d iam -c "
SELECT p.username,tu.id,r.code
FROM person p
JOIN tenant_user tu ON tu.person_id=p.id
LEFT JOIN user_role ur ON ur.user_id=tu.id
LEFT JOIN role r ON r.id=ur.role_id
WHERE tu.tenant_id='t-1' ORDER BY p.username;"
```

真实 OIDC 全链路已验证（2026-10-20）：
- 启动 `auth`(8081)、`rpapi`(8084)，用 `workflow_admin`/`Workflow123` 完成授权码 + PKCE；
- access token 的 `tenant_id=t-1`、`user_id=tu-workflow-admin`；
- 通过 userinfo 补齐 `groups=["workflow_admin"]`；
- 在 easy-workflow enforce 模式下完成 20 项 E2E：建流程、表单、发起、双人会签、附件、抄送、通知、审计、目录查询，全部通过。

密码哈希和 API Key 摘要已用本地命令校验：
- bcrypt `Workflow123` 校验通过；
- `wf_live_test_key_2026_01` 的 SHA-256 与库中 `key_hash` 一致。

## 4. 注意事项

- 当前 Docker 只确认了 Postgres；`auth`（8081）、`rpapi`（8084）、`gateway`（8100）未运行。联调前需在 ark-iam 仓启动对应服务。
- ark-iam 当前只读目录 API 仍没有「成员搜索 / 角色成员 / 部门成员/负责人」端点；easy-workflow 的目录代理只能使用已有的成员摘要/批量、部门树、角色清单。
- `workflow_web` 是 public client（`token_endpoint_auth_method=none`），依赖 PKCE；不要把 client secret 写进前端。
- 这些账号/API Key 是本地测试数据，不要带到生产环境。
