# easy-workflow-fork 作为 OA 审批工作流的评估

- 评估日期：2026-10-20
- 评估对象：`feature/web-process-designer` 分支（最新提交 `10e5ab1`）
- 范围：`workflow/` 引擎、`workflow/web_api/` 接口、`web/` 前端、`example/` 示例、数据库表、自检脚本
- 方法：源码静态审查 + `go build ./...` 通过；未运行 e2e（本机 3306 有 MySQL，但 8180/5173 未启动；为避免改动现有库数据，未启动后端）
- 文中路径均相对仓库根目录

---

## 一、结论

**一句话：这是一个“能跑通审批主流程的轻量工作流内核 + 演示型前端”，不是一套可直接交付的 OA 审批系统。**

分场景判断：

| 场景 | 结论 | 说明 |
| --- | --- | --- |
| 作为**嵌入式流程内核**，宿主系统自己提供用户、权限、表单、通知 | **基本达标** | 核心流转能力可用；但必须先修版本隔离、自由驳回校验、事务/并发、认证等 P0 问题 |
| 作为**内部小团队、单租户、低合规要求的 OA** | **勉强可用** | 还需补组织/角色、表单/附件、通知、审计；能接受手工输入用户 ID |
| 作为**生产级 / 多租户 / 有审计合规要求的 OA** | **不达标** | 权限体系、组织模型、表单引擎、流程版本治理、审计与可观测性均缺 |
| **直接暴露公网** | **不可** | 无认证 + 任意 TaskID 可操作 + 网关条件拼 SQL |

成熟度判断：**MVP / POC**。流程语义覆盖了不少“中国式审批”的典型诉求（会签、自由驳回、直接提交给驳回我的人），但工程化、产品化程度不足。

---

## 二、评分矩阵

| 维度 | 现状 | 评分（1–5） | 结论 |
| --- | --- | --- | --- |
| 流程建模 | 开始/任务/混合网关/结束；会签；事件；无子流程、多实例、定时边界事件 | 4 | 轻量够用 |
| 审批操作 | 通过/驳回/自由驳回/直接提交/转办/撤销 | 3.5 | 缺加签、抄送、委托、依次审批、撤回已办 |
| 组织与权限 | 无用户/部门/角色/岗位模型；角色靠事件解析；无 RBAC/数据权限 | 0.5 | 硬缺口 |
| 表单与业务 | 仅 key-value 变量，`VARCHAR(250)`；无表单引擎/附件/业务数据 | 1 | 硬缺口 |
| 通知协同 | 仅进程内事件回调；无站内信/邮件/IM/WebSocket/催办 | 1 | 硬缺口 |
| 审计合规 | 有任务历史表；转办删除原任务；无操作审计/留存策略 | 2 | 不足 |
| 流程治理 | 版本号有存但流转不按版本；无草稿/发布/停用/回滚 | 1.5 | 高风险 |
| 安全 | 无认证授权；网关条件拼 SQL；默认口令 | 0.5 | 不可上线 |
| 并发可靠 | 缓存 map 无锁；任务提交无行锁；事务边界分裂 | 1.5 | 高风险 |
| 前端 | LogicFlow 设计器/进度回显/动态按钮做得不错；无登录/表单/组织选择 | 3 | Demo 级 |
| 测试交付 | 3 个联调脚本；无 Go 单测、无 CI | 2 | 不足 |

综合：**作为 OA 产品约 2.5/5；作为嵌入式流程内核约 3.5/5。**

---

## 三、做得好的地方

1. **核心流转语义覆盖较全**：开始/任务/网关/结束四类节点，混合网关（排他/并行/包含），会签（全部通过/一人驳回），非会签（一人通过即通过），驳回、自由驳回、直接提交给驳回我的人、转办、撤销。见 `workflow/engine/ProcessNode.go`、`ProcessTask.go`。
2. **数据模型有基本的历史与批次概念**：`proc_inst`/`proc_task` 与 `hist_*` 分离；`batch_code` 支持节点被驳回后产生多批任务；任务有 `comment`、`finished_time`；实例有 `business_id`、`starter`。见 `workflow/database/tables.go`。
3. **自由驳回 / 直接提交**是相对差异化的能力，确实贴合中国式审批场景。见 `TaskFreeRejectToUpstreamNode`、`TaskPass(..., DirectlyToWhoRejectedMe)`。
4. **事件机制可扩展**：节点开始/结束、任务完成、流程撤销四类事件，可用反射挂到 struct 上；示例里演示了角色解析、通知、会签人数放宽。见 `workflow/engine/ProcessEvent.go`、`example/event/ExampleEvent.go`。
5. **前端设计器与引擎 JSON 契约清晰**：LogicFlow 画布与 `model.Process` 双向转换；NodeID 存在 `properties.nodeId`；网关分支由连线反推；本地 `validateProcess` 有较完整的错误/警告分级。见 `web/src/logicflow/convert.ts`。
6. **进度回显和动态按钮**：实例详情用任务历史在图上回显进度；待办按钮由 `/task/action` 动态计算，不在前端硬编码。见 `web/src/pages/InstanceDetailPage.tsx`、`web/src/components/TaskHandleDrawer.tsx`。
7. **有可执行的自检脚本**：`check:convert`（25 项）、`check:e2e`（29 项）、`check:engine`（32 项），覆盖转换、联调、网关/会签/驳回/撤销等语义。见 `web/scripts/`。
8. **修复了 `proc_execution` 未按 `proc_id` 过滤的串流程缺陷**：`TaskNextNode` 与 `TaskUpstreamNodeList` 已补 `proc_id` 条件，同库多流程可用。见 `workflow/engine/ProcessTask.go`。

---

## 四、OA 视角的功能缺失

### P0：组织与权限

- **没有用户/部门/角色/岗位/汇报关系模型**。`Node.Roles` 只是字符串数组，引擎不会解析；必须在节点开始事件里把角色映射成 `UserIDs`（`model/Node.go` 注释、`MyEvent_ResolveRoles`）。没有组织服务，就没有“按部门/上级/职级/岗位找人”。
- **没有登录、SSO、Token、会话**。前端顶栏直接输入用户 ID 切换身份，所有接口以该 ID 作为参数调用（`web/src/components/AppLayout.tsx:112-121`）。
- **没有 RBAC、数据权限、租户隔离**。`source` 只用于过滤流程定义，不隔离实例/任务；没有 tenant 字段。
- **任意调用者可操作任意任务**：`/task/pass`、`/task/reject`、`/task/reject/free`、`/task/transfer` 只接收 `TaskID`，不校验调用者是否是该任务的处理人（`workflow/web_api/router/routers.go:25-43`，`service.go`）。
- **任意调用者可保存/覆盖流程定义**：`/def/save` 的 `CreateUserID` 来自表单，且不校验租户/owner。
- **任意调用者可强制撤销任意实例**：`/inst/revoke` 的 `Force=true` 不需要管理员身份。
- 没有管理员、流程 owner、审计员等角色。

### P0：表单与业务

- **没有表单引擎**：没有表单定义、字段 schema、校验规则、字段权限、联动；发起和审批只有 `KeyValueEditor`（`web/src/pages/InstanceStartPage.tsx:165-168`、`TaskHandleDrawer`）。
- **变量只有 `VARCHAR(250)` 的字符串键值**（`workflow/database/tables.go:125-130`）；没有数字/日期/布尔/数组/JSON 类型，也没有长度校验。
- **没有附件/图片/文件上传**；没有富文本；没有电子签名。
- **没有业务数据查询/更新**：`BusinessID` 只是字符串，业务单据的读写完全由宿主系统负责；没有业务状态回写、没有业务表关联查询。
- **没有幂等**：同一业务 ID 可重复发起；双击“发起”会产生多个实例；审批重复提交也没有幂等键。
- **没有草稿**。

### P1：审批能力

- **没有加签/减签**（前加签、后加签）——这是国内 OA 最常被要求的能力之一。
- **没有抄送/传阅/知会**。
- **没有委托/代理**；转办是一次性转移，且会删除原任务，不能“代审后归还”。
- **没有依次审批/串行会签**：同一节点的所有处理人同时收到任务；要串行只能拆成多个节点。
- **会签只有“全部通过 / 一人驳回”**；没有比例会签（如 2/3 通过）、没有显式的或签配置（非会签=或签）。示例里用任务事件把 3 人会签改成 2 人通过，属于代码 hack，不是产品能力。
- **没有批量审批、批量转办**。
- **没有撤回已办/撤销单条审批**；只有发起人撤销整个实例（且非强制时只能回到发起节点）。
- **没有终止/作废/挂起/恢复**。
- **没有常用意见/审批模板/电子签名**。
- **没有优先级/紧急程度/截止时间**。
- **没有催办、超时提醒、自动升级**；`ScheduleTask` 是通用定时器，不是节点 SLA。
- **没有动态审批人规则**（按金额、部门、职级、审批矩阵）；只能靠变量 + 事件代码。

### P1：通知协同

- **没有内置通知渠道**（站内信、邮件、短信、IM、WebSocket）；事件里只能写日志或调用外部服务。示例的 `MyEvent_Notify` 只是 `log.Printf`。
- **事件同步执行在审批请求链路中**：慢通知会拖慢审批；事件失败会触发 `taskRevoke`，但外部副作用（已发邮件）无法回滚。
- **没有站内信/未读/已读**；没有实时推送。
- **没有评论线程、@、附件评论**；每个任务只有一个 `Comment`。

### P0/P1：流程治理

- **版本只存不用**：实例写入 `proc_version`（`ProcessInstance.go:76`），但 `GetInstanceNode`/`TaskNextNode` 按 `ProcID` 取当前定义（`ProcessNode.go:296`、`ProcessTask.go:541-575`）。发布新版本后，在途实例会立即按新图流转。
- **保存新版本会删除并重建 `proc_execution`**（`ProcessDefine.go:45-107`）。节点 ID 变化会让在途实例报“节点不存在”；节点语义变化会让审批路径与发起时不一致。
- **示例 `main` 每次启动都 `CreateExampleProcess()`**（`example/main.go:58`），即每次重启都会给“员工请假”升版本并重建执行表，在途实例受影响。
- **没有草稿/发布/停用/归档**；保存即生效。
- **后端不做流程结构校验**：`ProcessDefine.go:20` 明确 TODO；多开始节点、重复 NodeID、环、无处理人、任务多出线都可能入库。前端 `validateProcess` 只在浏览器里生效，直接调 API 可绕过。
- **没有版本历史查询/回滚 API**；`HistProcDef` 只存不用；没有定义 diff。
- **没有流程分类/分组/owner/权限**。

### P0：审计合规

- **没有操作审计日志**：谁、何时、从哪个 IP/UA、改了什么前后值，都没有；只有任务表里的 `Comment`。
- **转办删除原任务**（`ProcessTask.go:255-300`），历史里没有“谁转给谁、何时、为什么”的记录，审计链断裂。
- **撤销没有原因、没有审批**；强制撤销没有权限。
- **系统自动结束的任务 `status=0`**，没有原因、没有操作者，已办列表还会把它过滤掉。
- **历史表没有留存/归档/清理策略**，会无限增长。
- **没有数据导出、报表、合规查询**。

### P1：运维与非功能

- 无认证、限流、CORS、TLS、请求体大小限制。
- 无 health/readiness、metrics、trace、结构化日志。
- 无优雅停机。
- 无迁移工具，只有 `AutoMigrate`；生产改表风险高。
- 无 CI、无 Go 单测；只有依赖真实 MySQL + 后端的脚本。
- 多副本不安全：`ScheduleTask` 每个实例都跑；缓存和任务提交有竞态。
- MySQL 8 only（自由驳回用了递归 CTE）；无 PostgreSQL 支持。
- 默认数据库口令写在 README/example；Swagger 默认开启。
- 无备份/容灾方案（部署层）。

### P1：前端

- 无登录页/权限路由；顶栏切换用户（`AppLayout.tsx:112-121`）。
- 无组织/角色选择器，处理人靠手输用户 ID（`ListInput`）。
- 无表单渲染、附件、抄送、评论线程。
- 无工作台/统计/管理员视图；菜单只有流程定义、实例、任务。
- 列表一次拉 200 条后前端分页（`TodoPage.tsx:20`、`FinishedPage.tsx:29`），无服务端总数/游标。
- 已办详情依赖 `/task/info`，而该接口对归档任务有查询 bug（见下）。
- 实例详情用当前定义回显进度，版本升级后图与历史可能对不上。
- 无移动端适配/i18n。

---

## 五、代码级缺陷（按严重度）

### P0-1 无认证/授权，接口默认裸奔

- 证据：`workflow/web_api/router/routers.go:25-43` 直接注册路由；`example/main.go:79-80` 只挂了 `gin.Logger()` 和 `gin.Recovery()`；所有 handler 从 query/form 取 `userid`/`TaskID`，不校验调用者。
- 影响：任何人可审批/驳回/转办/撤销任意任务；可保存/覆盖任意流程；可查全量待办/已办/实例；可强制撤销。
- 建议：加 AuthN 中间件（JWT/SSO），注入 `CurrentUser`；任务操作校验 `task.UserID == currentUser` 或有代理/管理员授权；实例撤销校验 starter/admin；定义保存校验 owner/管理员；列表按数据权限过滤。如果定位是嵌入式库，至少提供认证/当前用户抽象和路由中间件扩展点。

### P0-2 流程版本不隔离，在途实例会被新定义“劫持”

- 证据：`ProcessInstance.go:76` 存 `proc_version`；`GetProcCache` 按 `ProcID` 缓存（`ProcessInstance.go:17-31`）；`GetInstanceNode` 从当前 cache 取（`ProcessNode.go:296`）；`TaskNextNode` 按 `proc_id` 查当前 `proc_execution`（`ProcessTask.go:541-575`）；`ProcessSave` 把旧 execution 移历史后删除重建（`ProcessDefine.go:45-107`）。
- 影响：发布新版本后，所有在途实例立即按新图流转；节点改名/删除会报“节点不存在”，实例卡死；审批路径可能与发起时不一致，审计无法解释。
- 建议：`proc_execution` 增加 `(proc_id, proc_version)` 约束；按版本读取；实例固定版本；保存新版本只增不改；提供版本迁移/终止策略；缓存 key 改为 `(procID, version)`。

### P0-3 自由驳回目标未校验，可跳步/强制结束

- 证据：`TaskFreeRejectToUpstreamNode` 只 `GetInstanceNode` 取任意 NodeID（`ProcessTask.go:469-510`，关键在 `:493`），不校验是否在上游列表、是否为任务节点。
- 影响：审批人可把任务“驳回”到下游审批节点（跳过中间审批）或直接驳到结束节点（把流程判完成）；也可驳到网关/开始节点造成异常。
- 建议：用 `TaskUpstreamNodeList` 校验目标必须是上游任务节点（或明确允许的节点类型）；后端强制，不能只靠前端下拉。

### P0-4 网关条件用字符串拼 SQL，存在注入/篡改/DoS

- 证据：`ExpressionEvaluator` 直接 `SELECT ` + expression，仅用正则黑名单过滤（`Utility.go:60-79`）；变量值原样 `strings.Replace` 进表达式（`ProcessNode.go:230-250`）；变量可由审批人通过 `VariableJson` 写入。
- 影响：流程定义作者可注入 `SLEEP`/`BENCHMARK` 等造成数据库 DoS；变量值可改变条件语义（如金额阈值），让审批走错分支；字符串/日期类型不加引号会直接 SQL 报错；黑名单可被绕过或误杀。
- 建议：换成安全表达式引擎（CEL/expr/govaluate），对变量做类型化绑定；禁止把用户输入拼 SQL；严格校验流程定义与变量 schema。

### P1-1 已办任务详情查不到（归档任务）

- 证据：`GetTaskInfo` 的归档分支写成 `FROM hist_proc_task WHERE id=?`，但传入的是 TaskID，且 select 的是 `task_id AS id`（`ProcessTask.go:308-335`，关键在 `:317`）。转办会删除任务造成 ID 错位，之后归档的 `hist.id` 与 `task_id` 不再相等。
- 影响：`/task/info` 对已归档任务返回“任务不存在”；前端“已办任务 → 详情”打不开；`/task/action` 同样受影响。
- 建议：改为 `WHERE task_id=?`；补一条已办详情回归用例。

### P1-2 事务边界不原子，失败补偿不完整

- 证据：`instanceInit` 开 `tx` 后调用 `InstanceVariablesSave`，后者自己 `DB.Begin()`（`ProcessInstance.go:84`、`:182`）；`taskSubmit` 同样在 `tx` 内调用它（`ProcessTask.go:648-681`、`:677`）。
- 影响：变量可能先于主事务提交；主事务回滚后变量残留；`taskSubmit` 提交后才跑事件/下一节点，失败时 `taskRevoke` 只恢复任务，不回滚变量、不回滚已生成的下游任务；事件外部副作用（通知）无法回滚。
- 建议：把变量写入纳入同一 `tx`；把“任务提交 + 事件 + 下一节点”设计成可重试的幂等操作或 outbox/saga；明确补偿边界。

### P1-3 并发控制缺失，重复审批/重复任务风险

- 证据：`ProcCache` 是普通 map，读写在实例启动/定义保存并发时无锁（`ProcessInstance.go:14-31`、`ProcessDefine.go:107`）；`taskSubmit` 按 id 更新，无 `is_finished=0` 条件/行锁（`ProcessTask.go:648-681`）；`CreateTask` 先查未完成任务再插入（`ProcessTask.go:18-90`），存在竞态；`ProcInstVariable` 无 `(proc_inst_id,key)` 唯一键（`tables.go:125-130`）。
- 影响：并发双击审批可能生成两套下游任务/重复通过；多副本启动可能触发 `concurrent map read and map write`；变量重复 key 导致条件读取不确定。
- 建议：用 `SELECT ... FOR UPDATE` 或 `UPDATE ... WHERE is_finished=0` 乐观锁；缓存加 `sync.RWMutex` 或 `sync.Map`；变量表加唯一键；`ProcessSave` 加锁/版本 CAS。

### P1-4 转办丢审计，且可产生空处理人

- 证据：`TaskTransfer` 删除原任务再插入新任务（`ProcessTask.go:255-300`）；`Users` 来自逗号分隔，空串会通过 `len(users) < 1` 检查（`ProcessTask.go:255-262`）。
- 影响：审计链断裂（谁转给谁、何时、为什么都没有）；可生成 `user_id=''` 的僵尸任务。
- 建议：不删原任务，改为“关闭原任务 + 新增转办记录/历史”；校验用户存在且非空；记录 operator/reason。

### P1-5 驳回路由依赖未定义顺序，多前驱时可能驳错节点

- 证据：`TaskNextNode` 在“上一节点是驳回”时取 `Nodes[0]`（`ProcessTask.go:609`），而 `TaskUpstreamNodeList` 的 CTE 没有 `ORDER BY`（`ProcessTask.go:445-460`）。
- 影响：多上游/分支汇聚的节点，驳回可能落到任意祖先，而不是直接上一个节点；流程走向不可预测。
- 建议：明确“直接前驱”定义，按 `proc_execution` 取直接 `prev_node_id`，加 `ORDER BY`/拓扑序；不要依赖 CTE 返回顺序。

### P1-6 后端不校验流程定义，坏图可入库

- 证据：`ProcessDefine.go:20` 明确 TODO；`ProcessSave` 只检查名称/来源/创建人（`ProcessDefine.go:23-35`）；`instanceInit` 对多开始节点用 `SELECT ... WHERE node_type=0` 无 `ORDER BY`（`ProcessInstance.go:56-62`）。
- 影响：无开始/结束、重复 NodeID、环、无处理人、任务多出线、多开始节点都能保存；运行时才报错，或随机选开始节点；前端校验可被直接调 API 绕过。
- 建议：后端复用一套结构校验（开始/结束唯一、NodeID 唯一、边/前驱一致、可达、无环、任务节点有处理人、任务单出线、网关配置合法）；保存时校验。

### P1-7 网关汇聚语义不完整

- 证据：`GateWayNodeHandle` 用 `InstanceNodeIsFinish` 统计该节点所有任务是否都完成（`ProcessNode.go:200-230`、`:312-325`），没有 token/批次概念。
- 影响：驳回重走/循环时，旧批次的已完成任务会让汇聚提前满足，或未走到的分支让并行汇聚永久等待；与 BPMN 并行/包含网关语义有差距。
- 建议：引入 token/批次维度的汇聚判断；明确“重走时旧审批是否有效”；补并行+驳回组合用例。

### P2：其他值得记录的问题

- `GetTaskToDoList`/`GetTaskFinishedList`/`GetInstanceStartByUser` 在 `userid` 为空时返回全量（设计如此），叠加无认证就是数据泄露。
- 分页 `rows=0` 返回空，API 文档示例却是 0；没有总数/游标。
- 所有错误统一 HTTP 400，没有错误码；前端只能展示字符串。
- 无幂等键，重复发起/重复提交无保护。
- `InstanceRevoke` 先跑撤销事件再归档（`ProcessInstance.go:150-180`），归档失败会出现“通知已发但流程未撤销”。
- `ScheduleTask` 是进程内 goroutine，无持久化/分布式锁/重试（`ScheduleTask.go:50-90`），多副本会重复执行。
- 多处 `tx.Commit()` / DB 错误未检查；`taskRevoke` 第二条 UPDATE 未检查错误（`ProcessTask.go:700-720`）。
- 示例默认口令、Swagger 默认开启、无 CORS/TLS/限流。
- 无 Go 单测/CI；`gofmt -l` 显示多个文件未格式化。

---

## 六、建议路线图

### P0：上线前必须（建议 2–4 周）

1. **身份与权限**：SSO/JWT + 当前用户中间件；任务归属/实例归属/管理员/代理人校验；数据权限与租户字段。
2. **组织模型**：用户/部门/角色/岗位/汇报线；节点处理人支持“角色/部门/上级/发起人上级/表单字段”解析；组织选择器。
3. **版本隔离**：按 `(proc_id, proc_version)` 读取定义与 execution；实例固定版本；只增不改；版本迁移/终止方案。
4. **安全与校验**：自由驳回目标校验；表达式引擎替换 SQL；后端流程定义校验；参数化/类型化变量；限流/CORS/TLS/密钥管理。
5. **事务与并发**：统一事务边界；任务提交乐观锁/行锁；缓存加锁；变量唯一键；转办审计。
6. **测试与 CI**：Go 单测（路由/驳回/会签/网关/版本/权限）+ testcontainers 集成测试 + race detector + GitHub Actions。

### P1：OA 可用性（建议 4–8 周）

7. **表单引擎**：表单 schema/设计器/渲染/校验/字段权限；业务数据 API；附件；草稿；幂等。
8. **审批能力**：加签/减签、抄送、委托、依次审批、比例会签、批量审批、撤回已办、终止/挂起、常用意见、优先级。
9. **通知协同**：站内信/邮件/IM/WebSocket；outbox 异步；催办/超时/SLA 升级；已读未读；评论线程。
10. **审计合规**：操作日志（who/when/IP/UA/前后值）、转办/撤销原因、历史留存/归档/导出、报表。
11. **流程治理**：草稿/发布/停用/归档、版本历史/回滚、分类/owner/权限、定义 diff。
12. **前端**：登录/权限路由、组织选择器、表单渲染、附件、抄送、工作台/统计、移动端。

### P2：进阶

13. 多租户、BPMN 导入导出、子流程/调用活动、定时边界事件、消息/信号事件、动态多实例、规则引擎、报表数仓、i18n。

---

## 七、验证说明与限制

- 已读：`workflow/engine/*`、`workflow/model/*`、`workflow/database/tables.go`、`workflow/web_api/*`、`web/src/*` 核心页面/转换/API、`example/*`、`Makefile`、`web/scripts/*`。
- `go build ./...` 通过（使用工作区临时 module cache；临时目录已清理）。
- 未运行 e2e：本机 3306 有 MySQL，但 8180/5173 未启动；为避免改动现有库数据，未启动后端执行 `check:e2e`/`check:engine`。因此上述缺陷为静态审查结论，建议在测试库复现。
- 未发现 `*_test.go`，未发现 CI 配置；现有自检是依赖真实服务的脚本。
