# 403 `WF_FORBIDDEN` 排查手册（含平台租户复用记录）

认证通过、但工作流判定无权限时返回：

```json
{"code":"WF_FORBIDDEN","message":"permission denied"}
```

先记住两条边界：

- **401 vs 403**：401 是没带 token / token 无效；403 说明 token 验签通过，单纯是角色不含所需权限。
- **403 vs 200 + `[]`**：403 是权限问题；能返回 200 但列表空，是数据不在当前租户（`tenant_id` 不匹配）。

## 1. 判定链路

```
Authorization: Bearer <token>
  → workflow/auth/jwt.go:84              验签，构造 Identity（含 groups）
  → workflow/auth/middleware.go:65       groups 为空时调 userinfo 补齐
  → 接口内的 requirePermission / requireAnyPermission   web_api/service/authz.go:31,44
  → Identity.Can                        auth/identity.go:85
      ├─ 租户覆盖 wf_role_permission（有行则以库为准）  web_api/service/rbac.go:18
      └─ 默认映射 DefaultRolePermissions  auth/identity.go:178（空角色集合＝拒绝）
  → 失败：403 WF_FORBIDDEN
```

`groups` 的来源决定了排查方向：ark-iam 只把「**token 的 tenant_id** + **客户端所属 application**」范围内的
角色编码写进声明（`ark-iam/backend/apps/auth/internal/core/oidcop/persistent_store.go:387-460`）。
两边对不上，`groups` 就是空的。

## 2. 定位三步

**① 看是哪个接口、什么账号**（后端日志）

```bash
grep '| 403 |' logs/backend.log | tail
```

**② 看该账号的角色到底有哪些**（PG `iam` 库）

```sql
-- 找一个自然人 → 所有租户成员 → 角色
SELECT t.code AS tenant, tu.id AS tenant_user, r.code AS role, a.code AS app
FROM person p
JOIN tenant_user tu ON tu.person_id = p.id AND tu.deleted_at IS NULL
JOIN tenant t ON t.id = tu.tenant_id
LEFT JOIN user_role ur ON ur.user_id = tu.id AND ur.deleted_at IS NULL
LEFT JOIN role r ON r.id = ur.role_id AND r.deleted_at IS NULL
LEFT JOIN application a ON a.id = r.app_id
WHERE p.username = '<用户名>';
```

**③ 按 `groups` 的口径复算一遍**（token 租户 + 客户端所属 app）

```sql
SELECT r.code AS group_claim
FROM application_client ac
JOIN role r ON r.app_id = ac.app_id
JOIN user_role ur ON ur.role_id = r.id
JOIN tenant_user tu ON tu.id = ur.user_id
JOIN person p ON p.id = tu.person_id
WHERE ac.code = 'workflow_web'
  AND tu.tenant_id = '<token 里的 tenant_id>'
  AND p.username = '<用户名>'
  AND ac.deleted_at IS NULL AND r.deleted_at IS NULL AND ur.deleted_at IS NULL;
-- 结果为空 → 401/403 的根因就在这里
```

对照表（`workflow/auth/identity.go:178`）：`workflow_admin` 全权限；`workflow_designer` 有 `def.read`；
`workflow_approver` 有 `instance.start` / `task.act`；`workflow_viewer` 只有 `read.own`；
`workflow_auditor` 有 `instance.read.tenant` / `audit.read`。

## 3. 常见根因

| 根因 | 特征 | 处理 |
|---|---|---|
| 角色不在该 token 租户 | 账号属于 A 租户，角色建在 B 租户 | 在 A 租户补角色（见第 4 节）或换 B 租户的账号登录 |
| 角色不在该应用下 | `role.app_id` 不是客户端所属应用 | 重建角色到正确 `app_id` |
| 角色 code 写错 | 例如 `workflow_Admin` / 自定义编码 | code 必须与 `DefaultRolePermissions` 的 key 完全一致 |
| 应用没订阅到租户 | `tenant_application` 无记录、角色为空 | 订阅应用（会触发角色模板物化） |
| 租户级覆盖把权限关掉 | `wf_role_permission` 有该角色行且不含目标权限 | `DELETE /process/admin/role-permissions?role=...` 恢复默认 |
| 机器凭证调自然人接口 | `WF_PERSON_REQUIRED` 而非本错误 | 用自然人账号 |

## 4. 平台租户复用（本轮实际执行）

目标：让平台租户（`type=platform`，如 `t_platform`）里的账号也能用工作流，而不把整套搬到业务租户。

平台租户原来只有 `platform_admin` / `tenant_admin` 两套内置应用的东西，缺三样：**easy_workflow 的角色、
应用订阅、业务数据**。客户端不用动——`groups` 解析只按 client code 找应用，不校验 `application_client.tenant_id`
（`ark-iam/backend/pkg/core/application/client.go:30`），所以一个客户端可以服务多个租户的登录。

### 4.1 写应用角色模板

角色模板是「应用对外提供的契约值」，订阅时按它物化到租户（`ark-iam/backend/pkg/core/tenant/provision.go:343`）。
生产环境请走平台管理后台 `PUT /v1/platform/applications/:appID`，本地可直接改库：

```sql
UPDATE application
SET role_template = '[{"code":"workflow_admin","name":"流程管理员"},
                      {"code":"workflow_designer","name":"流程设计者"},
                      {"code":"workflow_approver","name":"流程审批人"},
                      {"code":"workflow_viewer","name":"流程查看者"},
                      {"code":"workflow_auditor","name":"流程审计员"}]'::json
WHERE code = 'easy_workflow';
```

> 模板是**应用级全局契约**：从模板里移除角色，会把各订阅租户中 `source=builtin` 的同名角色软删
> （`provision.go:414` `withdrawStaleTemplateRoles`）。改动前确认影响面。

### 4.2 订阅应用并物化角色

首选平台管理后台 `POST /v1/platform/tenant-applications`（`{tenantId, appId}`），
服务端在同一事务里写订阅并调 `SyncAppRoleTemplate`（`ark-iam/backend/apps/platformadmin/internal/service/svctenantapplication/tenant_application.go:107`）。

直接用 SQL 时需要手工补齐两步：

```sql
-- 订阅
INSERT INTO tenant_application (id, tenant_id, app_id, status, created_by, created_at, updated_at)
VALUES ('ta-easy-workflow-<后缀>', '<TENANT_ID>', 'app-easy-workflow', 'enable', 'manual', now(), now());

-- 物化角色（等价于 SyncAppRoleTemplate：source=builtin、admin_type=normal）
INSERT INTO role (id, tenant_id, app_id, name, code, source, admin_type, created_by, updated_by, created_at, updated_at) VALUES
 ('role-wf-admin-<后缀>',    '<TENANT_ID>', 'app-easy-workflow', '流程管理员', 'workflow_admin',    'builtin', 'normal', 'manual', 'manual', now(), now()),
 ('role-wf-designer-<后缀>', '<TENANT_ID>', 'app-easy-workflow', '流程设计者', 'workflow_designer', 'builtin', 'normal', 'manual', 'manual', now(), now()),
 ('role-wf-approver-<后缀>', '<TENANT_ID>', 'app-easy-workflow', '流程审批人', 'workflow_approver', 'builtin', 'normal', 'manual', 'manual', now(), now()),
 ('role-wf-viewer-<后缀>',   '<TENANT_ID>', 'app-easy-workflow', '流程查看者', 'workflow_viewer',   'builtin', 'normal', 'manual', 'manual', now(), now()),
 ('role-wf-auditor-<后缀>',  '<TENANT_ID>', 'app-easy-workflow', '流程审计员', 'workflow_auditor',  'builtin', 'normal', 'manual', 'manual', now(), now());
```

> `role` 表只有主键唯一约束，**同一租户、同一应用下不要重复插入同名 code**，否则同一个账号会拿到重复角色。

### 4.3 给账号绑角色

```sql
INSERT INTO user_role (id, tenant_id, user_id, role_id, created_at, updated_at, created_by, updated_by)
VALUES ('ur-<账号>-wf-admin', '<TENANT_ID>', '<tenant_user_id>', 'role-wf-admin-<后缀>',
        now(), now(), 'manual', 'manual');
```

`user_role.user_id` 是 **tenant_user 主键**，不是 `person.id`。

### 4.4 生效时机

`groups` 为空时中间件每次请求都会走 userinfo（`workflow/auth/middleware.go:65`），
而 userinfo 实时读库，所以**下一次请求即生效，不用重新登录**；只有 token 已过期才需要重新登录。

## 5. 验证

```sql
-- 复算 groups（应返回 workflow_admin）
SELECT r.code FROM application_client ac
JOIN role r ON r.app_id = ac.app_id
JOIN user_role ur ON ur.role_id = r.id
JOIN tenant_user tu ON tu.id = ur.user_id
JOIN person p ON p.id = tu.person_id
WHERE ac.code='workflow_web' AND tu.tenant_id='<TENANT_ID>' AND p.username='<用户名>'
  AND ac.deleted_at IS NULL AND r.deleted_at IS NULL AND ur.deleted_at IS NULL;
```

浏览器刷新后：`GET /process/def/list?source=办公系统` 应返回 200。
若返回 200 + `[]`，说明权限已通，但该租户下没有流程定义——检查数据租户：

```sql
-- MySQL 业务库
SELECT tenant_id, COUNT(*) FROM proc_def GROUP BY tenant_id;
```

## 6. 本轮实例记录

| 项 | 值 |
|---|---|
| 现象 | `GET /process/def/list?source=办公系统` → 403 `WF_FORBIDDEN` |
| 登录账号 | `admin`，仅属于平台租户 `t_platform`（`type=platform`） |
| 已有角色 | `platform_admin`、`tenant_admin`（都不是 easy_workflow 的应用角色） |
| 工作流角色所在 | `t-1`（业务租户）5 个，平台租户 0 个 |
| 结论 | `(t_platform, easy_workflow)` 下无角色 → `groups=[]` → fail-closed 403 |
| 处理 | 写 `role_template` → 订阅 `easy_workflow` 到 `t_platform` → 物化 5 个角色 → `admin` 绑 `workflow_admin` |
| 结果 | groups 复算得到 `workflow_admin`，403 消除 |

### 遗留

1. **业务数据仍在别的租户**：示例流程在 MySQL 的 `default`（5 条，off 模式开发身份的租户）与 `t-1`（1 条），
   平台租户下为空，所以接口返回 200 + `[]`。要看到数据需把相关表的 `tenant_id` 统一改成目标租户：
   `proc_def`、`proc_def_version`、`proc_inst`、`proc_task`、`proc_execution`、`proc_inst_variable`、
   `hist_*`、`wf_audit_log`、`wf_form_template`、`wf_form_data`、`wf_attachment`、`wf_cc_recipient`、
   `wf_notification`、`wf_outbox_event`（唯一键都以 `tenant_id` 打头，改名不会冲突，但要整租户一起迁，
   只迁 `proc_def` 会得到「列表有、实例查不到」）。
2. **客户端归属**：`workflow_web` 仍属于最初的业务租户，功能无影响（按 code 跨租户解析），属配置债。
3. **系统租户承载业务数据**：`t_platform` 是平台自身的租户，平台运维与业务参与者共用同一账号边界；
   多租户生产环境应在独立 `customer` 租户里跑工作流，平台租户只留控制台。
