# 平台租户复用 easy-workflow：403 修复记录

日期：2026-10-21
现象：`GET /process/def/list?source=办公系统` 返回 `{"code":"WF_FORBIDDEN","message":"permission denied"}`（HTTP 403）。

## 根因

ark-iam 的 `groups` 声明按「token 的 tenant_id + 客户端所属 application」裁剪
（`backend/apps/auth/internal/core/oidcop/persistent_store.go:401-460`）。
登录账号 `admin` 属于平台租户 `t_platform`（`01a0cc72-ff20-7e73-9ede-a63d2a2ec02f`），
而 easy_workflow 的 5 个角色此前只存在于 `t-1`，且 `application.role_template` 为 `[]`，
因此 `(t_platform, easy_workflow)` 下查不到角色 → `groups=[]` → 工作流侧 fail-closed 拒绝。

## 处理（仅 PG `iam` 库，未动业务库 MySQL）

1. `application.role_template` 写入 5 个角色模板（code + name）。
2. 新增 `tenant_application` 订阅：`(t_platform, app-easy-workflow)`。
3. 按模板物化 5 个角色到 `t_platform`（`source=builtin`、`admin_type=normal`）。
4. `user_role`：`admin` 的 tenant_user 绑定 `workflow_admin`。

## 关键 ID

| 项 | 值 |
|---|---|
| 平台租户 | `01a0cc72-ff20-7e73-9ede-a63d2a2ec02f` |
| admin 的 tenant_user | `01a0cc72-ff46-77b4-8a78-23d6c2106190` |
| 应用 | `app-easy-workflow` |
| OIDC 客户端 | `workflow_web`（仍属 `t-1`，按 code 跨租户解析） |

## 验证

按 `appendRoleGroupClaims` 口径复算 admin 的 groups：

```sql
SELECT r.code FROM user_role ur
JOIN tenant_user tu ON tu.id=ur.user_id
JOIN role r ON r.id=ur.role_id
WHERE tu.person_id='01a0cc72-ff44-737a-8e9b-208149eef618'
  AND ur.tenant_id='01a0cc72-ff20-7e73-9ede-a63d2a2ec02f'
  AND r.app_id='app-easy-workflow'
  AND ur.deleted_at IS NULL AND r.deleted_at IS NULL;
-- → workflow_admin
```

## 遗留

- 业务数据仍在 `default` / `t-1`，平台租户下没有流程定义，接口会返回 200 + `[]`；
  要看到数据需把 MySQL 的 `tenant_id` 迁到平台租户 id（本次按要求未执行）。
- `workflow_web` 客户端名义上属于 `t-1`（功能无影响，属配置债）。
- 平台租户 `type=platform`，属系统租户；多租户生产环境不应承载业务数据。
