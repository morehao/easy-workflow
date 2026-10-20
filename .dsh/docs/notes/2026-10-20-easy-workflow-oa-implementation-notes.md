# easy-workflow OA 改造实施记录

日期：2026-10-20
分支：`feature/web-process-designer`
关联设计：`.dsh/docs/specs/2026-10-20-easy-workflow-oa-design.md`
关联计划：`.dsh/docs/plans/2026-10-20-easy-workflow-oa-plan.md`

## 0. 当前总体状态

P0–P5 的**核心链路**已落地并通过构建/单测/E2E/真实 MySQL 场景验证：
配置与健康检查、OIDC + 租户 + RBAC、版本化流程、表单/附件、加签/抄送/委托/依次/比例审批、通知/outbox/审计/SLA/指标。
剩余主要是：ark-iam 侧应用/客户端/目录端点开通、拖拽表单设计器/对象存储/病毒扫描、挂起/催办、邮件/IM、tracing、压测与安全矩阵。
这些属于增强或外部依赖，不影响当前核心审批链路。

## 1. 本次已完成

### P0 工程基座
- 新增 `workflow/config`：`AUTH_MODE=off|optional|enforce`、OIDC issuer/audience/JWKS、开发身份、优雅停机超时、feature flag。
- 新增 `/healthz`、`/readyz`（DB ping）。
- `StartWebApiGraceful` 支持 SIGINT/SIGTERM；旧 `StartWebApi` 保留兼容。
- 测试基线：config/auth/service/engine 单测。

### P1 组织与权限（ark-iam 对接）
- 新增 `workflow/auth`：
  - 无第三方依赖的 RS256/JWKS 验签，校验 `iss/aud/exp/nbf/iat`，拒绝 `jwk/jku/x5u`。
  - 提取 `tenant_id`、`user_id`、`person_id`、`client_id`、`groups`、`scope`、`sid`、`act`。
  - `off` 模式注入开发身份，保持旧行为；`enforce` 失败闭合。
- API 授权：任务处理人/读者、实例读者/撤销者、定义读写/发布、统计/审计/管理权限。
- 关键修复：`Task_Pass` 之前缺少任务归属校验，已补 `requireTaskActor`，并用真实 MySQL + OIDC 验证。
- 租户隔离：
  - `proc_def`、`proc_inst`、`proc_task`、`proc_execution`、`proc_inst_variable` 及历史表增加 `tenant_id`。
  - 定义/实例/任务/历史/统计查询与命令均带租户；`proc_def` 唯一键从 `(name,source)` 改为 `(tenant_id,name,source)`，启动时自动删旧键。
  - 启动时回填 `proc_def_version`（旧数据基线）。
- 租户级 RBAC 持久化：
  - `wf_role_permission` 表 + `auth.PermissionResolver` 可插拔解析；某角色无行时回退代码默认映射。
  - `GET/PUT/DELETE /admin/role-permissions`（仅 `workflow.admin`）；支持 `*` 与 `__none__`。
- 前端：
  - 自包含 OIDC Authorization Code + PKCE 客户端（`web/src/auth/oidc.tsx`），无新增运行时依赖。
  - 登录门、回调页、axios Bearer 注入、退出、租户/用户显示。
  - 未配置 `VITE_OIDC_*` 时完全放行，现有本地开发/e2e 不受影响。

### P3 表单与附件
- `wf_form_template`：按 `(tenant_id, proc_def_id, proc_version, form_key)` 固定 schema；`/form/template` 保存/读取/列表。
- `wf_form_data`：按 `(tenant_id, proc_inst_id, form_key)` 存一份表单值；`/form/data` 保存/读取/列表。
- 后端表单校验：必填、类型（text/textarea/number/amount/date/select/switch）、min/max、maxLength、select options、未知字段拒绝；schema 字段名/类型校验。
- 前端：
  - 流程定义详情页增加「申请单表单模板」JSON 编辑器（MVP，非拖拽设计器）。
  - 实例详情页增加申请单渲染/保存（发起人/当前任务处理人可编辑，其他读者只读）。
  - 附件面板：上传、列表、下载、删除；上传走后端本地目录，单文件上限可配。
- 附件安全：文件名清洗、随机 storage key、类型白名单、大小限制、路径逃逸校验、下载走鉴权；生产建议替换对象存储/病毒扫描。

### P4 审批能力（已落地部分）
- 加签：`POST /task/add-sign`，同节点追加会签处理人，原任务转 `is_cosigned=1`；实测任务 73 加签 U0002 后节点等待两人。
- 批量通过：`POST /task/batch-pass`，先逐任务鉴权再执行，返回成功/失败明细；待办页支持多选。
- 抄送：`wf_cc_recipient` + `/cc/add|list|read|instance`；发起流程可带 `CcUserIDs` 自动抄送；新增「抄送我的」页面。
- 委托：`wf_task_delegation` + `/delegation`；受托人待办合并委托人的任务，且可读写委托任务；新增「任务委托」页面。
- 转办：沿用已有 `/task/transfer`。
- 依次审批：`ApproveMode=sequential`；当前人通过后自动给下一个处理人建任务，不提前流转。
- 比例审批：`ApproveMode=percentage` + `ApprovePercent`；只生成 `ceil(N*pct/100)` 个任务，全部通过后流转。
- 用户顺序改为保持 `UserIDs` 输入顺序（`MakeUnique`/`resolveNodeUser`），确保依次/比例可预测。
- 挂起/恢复：`/inst/suspend|resume`，状态 3；挂起后任务通过/表单编辑返回 409。
- 催办：`/inst/urge` 给当前未完成任务处理人写 outbox 通知。
- 终止：`/inst/terminate` 作为 `Force` 撤销的语义化别名；前端实例详情增加挂起/恢复/催办/终止按钮。
- 批量/加签/委托/依次/比例均走原有任务表与流程语义，默认 `ApproveMode` 为空时行为不变（E2E 32/32、29/29 回归通过）。

### P5 通知/审计/SLA/可观测（核心）
- 站内通知：`wf_notification` + `/notification/list|unread-count|read|read-all`；前端新增「站内通知」页面。
- Outbox：`wf_outbox_event` + 2s 轮询 worker；实例发起/任务通过/加签/抄送写事件，worker 转通知；`StartOutboxWorker()` 在 example 启动。
- 审计：`wf_audit_log` + 写操作中间件（不记录 body）；`/audit/list`、`/audit/export` CSV；管理员权限 `workflow.audit.read`。
- SLA：`proc_task.due_at`/`hist_proc_task.due_at`；默认 48h（`EASY_WORKFLOW_TASK_SLA_HOURS`）；待办/任务详情展示截止时间，超时标红。
- 可观测：`/metrics` 暴露定义数、实例状态数、待办数、SLA 超时数、outbox pending、未读通知、goroutine/内存。
- 通知通道：可选 `EASY_WORKFLOW_WEBHOOK_URL`，outbox worker 在本地通知之外 POST IM/邮件网关；失败不影响本地通知。
- 请求追踪：`X-Request-ID` 透传/生成，写入审计 `request_id` 字段。
- ark-iam access token 不含 `groups`，enforce 模式通过 `EASY_WORKFLOW_OIDC_USERINFO_URL` 调 userinfo 补齐角色。
- 目录本地联调走 rpapi `x-api-key` 通道（`EASY_WORKFLOW_DIRECTORY_API_KEY_HEADER=true`），因为 API Key 换 token 的 access token 当前不带 `scope` 声明。
- 压测脚本：`web/scripts/load-test.py`（并发只读待办列表，输出 RPS/P50/P95/错误率）。
- 附件：本地目录、单文件上限、类型白名单、路径逃逸校验；生产可替换对象存储。

### P2 流程定义版本与一致性
- `proc_def_version` 不可变版本表；`ProcessSaveForTenant` 每次保存写版本行，旧 `proc_execution` 行保留。
- 实例钉住 `proc_version`；`GetProcCacheVersion`、`GetInstanceNode`、`TaskNextNode`、`TaskUpstreamNodeList` 按版本读取。
- 前端实例详情按 `instance.ProcVersion` 取定义，发布新版本不改变在途实例进度图。
- 后端流程定义校验 `ValidateProcess`：
  - 唯一开始节点/至少一个结束节点、NodeID 唯一、上级存在、任务节点单出边、网关分支存在、表达式可解析、可达性、无环。
- 网关表达式改为安全解析器（`workflow/engine/Expression.go`），不再拼接 SQL；支持数字/字符串/布尔、比较、逻辑、算术、括号。
- 自由驳回校验：目标必须在当前任务的上游节点列表内，禁止驳到下游/结束节点。
- 并发/事务：
  - 实例初始化与变量写入同一事务；变量解析支持事务内读取。
  - `taskSubmit` 更新任务带 `WHERE is_finished=0`，`RowsAffected=0` 返回“已被处理”，防双击/并发重复审批。
- 幂等：
  - `command_log` 表 + `Idempotency-Key` 中间件；同 key 同 body 返回首次响应，同 key 不同 body 409，处理中 409；非 2xx 不缓存。
  - 未带 key 时保持旧行为。

## 2. 验证结果

| 验证 | 命令/方式 | 结果 |
|---|---|---|
| Go 构建 | `go build ./...` | 通过 |
| Go 单测 | `go test ./...` | 通过 |
| 前端类型 | `npm run typecheck` | 通过 |
| 前端构建 | `npm run build` | 通过 |
| 引擎 E2E | `npm run check:engine` | 32/32 通过 |
| 设计器→引擎 E2E | `npm run check:e2e` | 29/29 通过 |
| 转换自检 | `npm run check:convert` | 25/25 通过 |
| 鉴权 enforce | 匿名/坏 token/越权/跨租户 | 匿名 401、坏 token 401、无权限 403、跨租户 404 |
| 租户隔离 | t-1 token 查默认租户数据 | 列表 null、任务/实例 404 |
| 版本钉住 | 保存 v2 后查在途任务 | 仍读 v1 节点/上游，`/task/action` 200 |
| 幂等 | 同 key 两次 + 不同 body | 200/200/409，仅 1 个版本 |
| 自由驳回 | 驳 END / 驳 Start | 400 / 200 |
| 目录客户端 | `go test ./workflow/directory`（httptest） | 通过（成员/批量/404/403/500/超限） |
| RBAC 覆盖 | 管理员改为仅 `workflow.task.act` 后用 approver token 发起 | 403；重置后 400（权限已恢复，流程不存在） |
| 表单模板 | 保存/读取 proc1 v5 schema | 200/200；DB 行 tenant/proc/version 正确 |
| 表单数据 | 合法/缺必填/未知字段 | 200/400/400 |
| 附件 | 上传 txt → 列表 → 下载 → 删除 | 200；下载内容一致；删除 200 |
| P3 回归 | `check:engine` / `check:e2e` | 32/32、29/29 |
| 加签 | 任务 73 加签 U0002 | 200；节点转会签，U0002 待办出现 |
| 批量通过 | 任务 73/91 一起通过 | 200；实例流转到并行节点 |
| 抄送 | 发起带 CcUserIDs、列表、已读、追加 | 200；未读/已读状态正确 |
| 委托 | 张经理→U0002，U0002 待办/审批 | 待办包含委托任务；审批 200；委托后可读任务/实例 |
| 通知 | CC 触发 outbox，worker 转通知 | 列表/未读数/已读正确 |
| 审计 | 写操作后 `/audit/list`、`/audit/export` | 记录动作/状态/IP；CSV 可下载 |
| SLA | 发起后查任务 DueAt / metrics | 48h 截止；`wf_task_overdue_total` 暴露 |
| 指标 | `GET /metrics` | 输出 wf_* 与 go_* 指标 |
| 依次审批 | U0001→U0002→U0003 顺序 | 每次只生成下一个人的任务；最后流转 END |
| 比例审批 | 4 人 50% | 只生成 2 个任务；通过 1 个仍在 Approve，2 个后 END |
| 挂起/恢复 | 挂起后 pass / 恢复后 pass | 409 / 200 |
| 催办/终止 | urge / terminate | urged=1；terminate 后状态 2 |
| Webhook | httptest 接收 event/payload | 单测通过 |
| 压测 | 100 请求 / 20 并发 | 0 错误，P95≈64ms（本机空载） |
| 真实 OIDC 全链路 | ark-iam auth+rpapi + easy-workflow enforce | **20/20 通过**：授权码+PKCE、userinfo groups、建流程/表单/双人会签/附件/抄送/通知/审计/目录 |

补充证据：
- `proc_def` 旧唯一键 `uix_name_source` 已删除，新键 `uix_tenant_name_source` 存在。
- `proc_def_version` 旧定义回填成功；`proc_execution` 同时保留 v1/v2 行。
- 真实 MySQL 验证后，测试用合成定义（t-1 租户测试流程、幂等测试流程）已清理；早期误操作过的实例 4/任务 14 已恢复为 Manager 待办。

## 3. 关键实现决策/偏差

1. **前端 OIDC 用自包含 PKCE，而不是 `react-oidc-context`**  
   原因：不增加运行时依赖，避免 npm 网络/版本阻塞；行为等价于授权码 + PKCE。  
   后续如需 silent renew、多标签页同步，可替换为 `oidc-client-ts`，接口保持不变。

2. **未引入 BFF**  
   浏览器直接与 ark-iam token endpoint 交换 token，需要 ark-iam 允许前端 origin 的 CORS、登记 redirect URI。  
   若生产不允许浏览器直连，应增加 BFF（session cookie + 服务端 token），前端只保留登录跳转。

3. **租户来源**  
   从 access token 的 `tenant_id` 取；开发模式 `EASY_WORKFLOW_DEV_TENANT` 默认 `default`。  
   组织/人员目录（搜索、角色成员、部门成员/负责人）尚未接 rpapi，属于 P1 剩余。

4. **版本兼容**  
   `proc_def.resource` 保留为当前版本；旧实例若钉的版本早于回填版本，运行时回退当前定义（legacy）。  
   新保存的版本都有 `proc_def_version` 行，可精确回放。

5. **目录 BaseURL 约定**  
   `EASY_WORKFLOW_DIRECTORY_BASE_URL` 要填到 `/v1/rp/directory`（客户端再拼 `/members`、`/departments/tree`、`/roles`）。  
   目录接口返回 503 表示未配置/上游不可用；401/403/404 分别映射为 502/502/404，不降级放行。

6. **幂等键保留 24h**  
   `command_log` 目前不自动清理；后续加定时任务或分区。  
   前端尚未统一生成/复用 `Idempotency-Key`，需要页面级 key（尤其审批按钮）。

## 4. 尚未完成

### P1 剩余
- ark-iam 目录代理已接**现有契约**：成员摘要/批量、部门树、角色清单（`workflow/directory` + `/directory/*`）。
- 仍缺的目录能力（ark-iam 当前没有这些端点，需要 additive 改造或本地索引）：
  - 成员搜索（`/members/search`）
  - 角色成员（`/roles/{code}/members`）
  - 部门成员/负责人（`/departments/{id}/members`、`/leaders`）
- 角色/权限持久化已完成 `wf_role_permission` + 管理接口；前端管理页尚未做。
- ark-iam 应用/客户端开通：redirect URI、CORS、`groups` claim、`tenant_id`/`user_id` claim。
- 租户开通/管理员绑定流程。

### P3 剩余增强
- 表单设计器从 JSON 编辑升级为拖拽/字段属性面板；字段权限、联动、子表。
- 附件对象存储、病毒扫描、在线预览、版本管理。
- OA 工作台聚合（待办/已办/我发起/抄送）与移动端适配。

### P4 剩余
- 动态处理人（部门负责人、角色、表单字段）仍需目录/角色成员接口。
- 会签中“比例驳回”等更细粒度规则。
- 终止/挂起的事件通知语义可继续细化。

### P5 剩余增强
- 具体邮件/IM 网关适配（当前 webhook 通用出口）与 SLA 超时自动升级。
- OpenTelemetry tracing、结构化日志、Grafana 面板/告警。
- 更完整的压测/安全测试（越权矩阵、幂等并发、跨租户、上传型攻击）；本轮已做定向验证和 100 请求/20 并发只读压测。

## 5. 复现验证

```bash
# Go
GOMODCACHE=/tmp/easy-workflow-gomod GOCACHE=/tmp/easy-workflow-gocache GOFLAGS=-mod=mod go build ./...
GOMODCACHE=/tmp/easy-workflow-gomod GOCACHE=/tmp/easy-workflow-gocache GOFLAGS=-mod=mod go test ./...

# 前端
cd web
npm run typecheck
npm run build
npm run check:convert
npm run check:e2e       # 需后端 :8180、Vite :5173
npm run check:engine    # 需后端 :8180、Vite :5173
```

鉴权联调环境变量（示例）：

```bash
EASY_WORKFLOW_AUTH_MODE=enforce
EASY_WORKFLOW_OIDC_ISSUER=http://127.0.0.1:9099
EASY_WORKFLOW_OIDC_AUDIENCE=workflow_web
EASY_WORKFLOW_OIDC_JWKS_URL=http://127.0.0.1:9099/jwks
EASY_WORKFLOW_SEED_EXAMPLE=false
EASY_WORKFLOW_DEMO_AUTOFINISH=false

# ark-iam 目录（可选；四项必须同时配置）
EASY_WORKFLOW_DIRECTORY_BASE_URL=http://127.0.0.1:8084/v1/rp/directory
EASY_WORKFLOW_DIRECTORY_TOKEN_URL=http://127.0.0.1:8081/oidc/oauth/token
EASY_WORKFLOW_DIRECTORY_API_KEY=<raw api key>
EASY_WORKFLOW_DIRECTORY_RESOURCE=rpapi
```
