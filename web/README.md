# easy-workflow 前端

基于 [LogicFlow](https://github.com/didi/LogicFlow) 的流程设计器 + 流程审批台，对接本仓库 Go 引擎的 `web_api` REST 接口。

技术栈：**React 18 + Vite 5 + TypeScript + Ant Design 5 + LogicFlow 2**。

## 快速开始（前后端一起跑通）

### 最快的方式：一条 make 命令

在**仓库根目录**（不是 `web/`）执行：

```bash
make            # 启动后端 :8180 + 前端 :5173，Ctrl-C 一起停止
make check      # 另开一个终端，跑 25+29+32 项自检
make help       # 查看全部命令
```

`make` 会自动检查端口与数据库、首次运行自动 `npm install`，并把两端日志同时打到终端
（带 `[后端]` / `[前端]` 前缀）和 `logs/` 目录。下面是**不用 make 的手动步骤**。

### 1. 准备 MySQL 8

引擎会自动建表（`AutoMigrate`），但**不会建库**，所以先建库。用 Docker 最省事：

```bash
docker run -d --name easy-workflow-mysql \
  -e MYSQL_ROOT_PASSWORD=123456 \
  -e MYSQL_DATABASE=easy_workflow \
  -e MYSQL_USER=goeasy \
  -e MYSQL_PASSWORD='sNd%sLDjd*12' \
  -p 3306:3306 mysql:8.0 \
  --character-set-server=utf8mb4 --collation-server=utf8mb4_general_ci
```

已有 MySQL 实例时，建库 + 建用户即可：

```sql
CREATE DATABASE easy_workflow DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER 'goeasy'@'%' IDENTIFIED BY 'sNd%sLDjd*12';
GRANT ALL PRIVILEGES ON easy_workflow.* TO 'goeasy'@'%';
FLUSH PRIVILEGES;
```

> 必须 MySQL 8（引擎的自由驳回用了递归 CTE）。

### 2. 启动 Go 后端

```bash
go run example/main.go          # 监听 :8180，接口前缀 /process
```

首次启动会：建 10 张表 → 播种示例流程「员工请假」（`ProcID=1`）。
启动成功会打印 `easy workflow 启动成功` 和监听地址。

数据库连接默认指向本地（`goeasy@127.0.0.1:3306/easy_workflow`），可用环境变量覆盖：

| 环境变量 | 默认值 |
| --- | --- |
| `EASY_WORKFLOW_DSN` | 完整 DSN，设置后忽略下面几项 |
| `EASY_WORKFLOW_DB_HOST` | `127.0.0.1:3306` |
| `EASY_WORKFLOW_DB_USER` | `goeasy` |
| `EASY_WORKFLOW_DB_PASS` | `sNd%sLDjd*12` |
| `EASY_WORKFLOW_DB_NAME` | `easy_workflow` |
| `EASY_WORKFLOW_API_ADDR` | `:8180` |

### 3. 启动前端

```bash
cd web
npm install
npm run dev                     # http://localhost:5173
```

前端通过 Vite 代理把 `/process` 转发到 `http://127.0.0.1:8180`，因此**不需要后端做静态托管、也没有跨域问题**。
后端地址不同时可覆盖：

```bash
VITE_PROXY_TARGET=http://127.0.0.1:9000 npm run dev
```

### 4. 验证联通

```bash
npm run check:e2e      # 需要上面三步都启动着
```

会真实走一遍：设计器导出定义 → `POST /def/save` → 发起实例 → 查待办 → 审批通过 → 校验实例完成，
并回归「同库多个流程互不串流程」。

### 可用脚本

| 脚本 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器（含 API 代理） |
| `npm run build` | 类型检查 + 生产构建，产物在 `web/dist` |
| `npm run preview` | 预览生产构建 |
| `npm run typecheck` | 仅做 TypeScript 类型检查 |
| `npm run check:convert` | 纯前端自检（25 项断言，不需要后端） |
| `npm run check:e2e` | 前后端联调自检（29 项断言，需要后端 + Vite 都在跑） |
| `npm run check:engine` | 引擎流程语义自检（32 项断言，覆盖网关/会签/驳回/撤销） |

> 若 `npm install` 报 `npm error sudo chown -R 501:20 "~/.npm"`，说明本机 npm 缓存目录权限有问题，
> 可以临时指定缓存目录绕过：`npm_config_cache=/tmp/npm-cache npm install`。

## 功能

| 页面 | 路由 | 对应后端接口 |
| --- | --- | --- |
| 流程定义列表 | `/defs` | `GET /def/list` |
| 流程设计器（新建） | `/defs/new` | `POST /def/save` |
| 流程设计器（编辑） | `/defs/:id/edit` | `GET /def/get`、`POST /def/save` |
| 流程定义详情 | `/defs/:id` | `GET /def/get`、`GET /def/list` |
| 发起流程 | `/instances/start` | `GET /def/list`、`POST /inst/start` |
| 我的发起 | `/instances/mine` | `GET /inst/start/by`、`POST /inst/revoke` |
| 实例详情（含流程图回显） | `/instances/:id` | `GET /inst/task_history`、`GET /def/get` |
| 待办任务 | `/tasks/todo` | `GET /task/todo`、`GET /task/action`、`/task/pass` 等 |
| 已办任务 | `/tasks/finished` | `GET /task/finished`、`GET /task/info` |

想直接看设计器效果，可以打开 **`/defs/new?demo=1`**，会自动载入内置的「员工请假」示例流程（含排他网关、并行网关、会签节点）。

### 流程设计器

- 左侧节点面板：拖拽或点击添加开始 / 任务 / 网关 / 结束节点
- 连线：从节点锚点拖出即可；内置连接校验（禁止自环、开始节点不能作为目标、结束节点不能作为起点）
- 右侧属性面板：节点处理人、角色、会签开关、节点事件；网关的分支类型与条件表达式；连线级别可单独设置「条件分支 / 必然执行分支」
- 工具栏：撤销 / 重做 / 缩放 / 适应画布 / 自动布局 / 删除 / 导出 PNG / 载入示例 / 清空 / 校验 / 保存
- 保存前会用 `validateProcess` 做本地校验，**有 error 时阻止保存**，避免把非法定义写进数据库

### 待办任务的按钮是动态的

引擎在 `GET /task/action` 里根据「当前任务状态 + 流程定义 + 用户身份」算出允许的操作集合，
因此前端不硬编码「通过 / 驳回」按钮，而是按后端返回的 `CanPass`、`CanReject`、
`CanFreeRejectToUpstreamNode`、`CanDirectlyToWhoRejectedMe` 动态渲染。

## 关键设计

### 流程定义 JSON 是唯一契约

设计器的画布数据（LogicFlow 的 `nodes` / `edges`）和引擎的 `model.Process` 是两种结构，
中间由 `src/logicflow/convert.ts` 双向转换：

- LogicFlow 的节点 id 是合成的（`lf_node_1`、`lf_node_2`…），引擎的 `NodeID` 存在 `properties.nodeId` 里。
  这样**重命名 NodeID 只是改一个属性**，不会产生悬空引用。
- 网关的 `Conditions` / `InevitableNodes` **在导出时由连线反推**，不按边单独存储目标 NodeID，
  避免改名后引用失效。
- 引擎的 `Nodes[].PrevNodeIDs`（反向指针）由连线的 source/target 生成，这是引擎实际使用的结构。

三种网关语义的映射：

| 设计器模式 | 导出的 `GWConfig` |
| --- | --- |
| 排他（exclusive） | 所有出线进 `Conditions`（各带表达式），`InevitableNodes = null` |
| 并行（parallel） | 全部出线进 `InevitableNodes`，`Conditions = null`，`WaitForAllPrevNode = 1` |
| 包容（inclusive） | 按每条连线自己的「条件 / 必然执行」归类，`WaitForAllPrevNode` 取节点属性 |

### 转换自检

流程定义 JSON 是与 Go 引擎的唯一契约，一旦转换出错就是线上故障，所以有一份可执行的回归用例：

```bash
npm run check:convert
```

覆盖 25 项断言：示例流程满足引擎约束、`Process → LogicFlow → Process` 往返**完全无损**、
三种网关语义映射正确、校验规则能拦住非法定义（缺开始节点 / NodeID 重复 / 悬空引用 / 不可达节点 /
任务节点无处理人）、实例进度回显（含跨网关的连线识别）、自动布局不重叠。

### 联调自检

两个脚本都需要 MySQL + Go 后端 + Vite 都在跑，都通过 Vite 代理访问后端（顺带验证代理链路）：

```bash
npm run check:e2e      # 29 项：前端导出的定义能否被引擎接受 + 多流程不串流程
npm run check:engine   # 32 项：引擎自身的流程语义（网关分支 / 并行汇聚 / 会签 / 驳回 / 撤销 / 已办）
```

`check:e2e` 真实走完整条链路：`graphToProcess()` 产出定义 → `POST /def/save` → `GET /def/list` /
`/def/get` → `POST /inst/start` → `/task/todo` → `/task/action` → `/task/upstream` → `POST /task/pass`
→ 实例完成状态校验。

其中**第 2、3 组是引擎缺陷的回归用例**：故意创建两个节点 ID 完全相同的流程（都用 `Start`/`Fill`/`END`），
分别发起审批，验证两者各自只在自己的流程内流转。

### 已修复的引擎缺陷：同库多流程会互相串流程

`proc_execution` 是**所有流程定义共用**的一张表，但下面两处查询漏了 `proc_id` 过滤：

| 位置 | 影响 |
| --- | --- |
| `workflow/engine/ProcessTask.go` `TaskNextNode()` | 解析任务的下一个节点时 `Where("prev_node_id=?")` 会跨流程命中，**流程直接流转失败** |
| `workflow/engine/ProcessTask.go` `TaskUpstreamNodeList()` | 自由驳回的上游节点 CTE 会跨流程命中，**驳回目标列表是错的** |

触发条件很常见：两个流程都用了 `Start` / `END` 这类通用节点 ID。
`First()` 按主键排序取第一条，于是 B 流程的实例会去 A 流程里找节点，报
`ID为N的流程实例中不存在ID为xxx的节点`。

**结论：修复前，一个数据库实际上只能放一个流程定义。** 本仓库已给这两处补上 `proc_id` 过滤，
修复后同库可以放任意多个流程、节点 ID 也可以重名。改动仅 4 行 SQL 条件，不涉及引擎流程逻辑。

### 字段名的坑

后端不同接口的变量字段名不一致，写错不会报错、变量会被静默丢弃：

- `POST /inst/start` 用 **`VariablesJson`**（复数）
- `/task/pass`、`/task/reject`、`/task/reject/free` 等用 **`VariableJson`**（单数）

（注意 `/task/reject/free` 的 swagger 注释写的是 `VariablesJson`，但代码读的是 `VariableJson`，以代码为准。）

另外开始节点的处理人一般配成 `$starter`，前端发起流程时必须把 `{"Key":"starter","Value":"用户ID"}`
放进变量里，否则引擎找不到处理人。

## 目录结构

```
web/
├── scripts/
│   ├── verify-convert.ts           # 纯前端转换自检（不需要后端）
│   └── verify-e2e.ts               # 前后端联调自检（需要后端 + Vite）
└── src/
    ├── api/                        # 后端接口封装（client / def / inst / task）
    ├── components/
    │   ├── designer/               # 节点属性、连线属性、流程属性、校验结果面板
    │   ├── FlowCanvas.tsx          # LogicFlow 画布封装（可编辑 / 只读）
    │   ├── FlowViewer.tsx          # 只读流程图 + 进度高亮
    │   └── TaskHandleDrawer.tsx    # 动态审批操作抽屉
    ├── hooks/useAsyncData.ts
    ├── logicflow/
    │   ├── constants.ts            # 节点类型、颜色、进度状态
    │   ├── nodes.ts                # 自定义节点注册 + 主题 + 连接规则
    │   ├── convert.ts              # 引擎 <-> LogicFlow 双向转换、校验、进度计算
    │   ├── viewport.ts             # 自适应缩放（保证节点文字可读）
    │   └── example.ts              # 内置示例流程
    ├── pages/                      # 各路由页面
    └── types/workflow.ts           # 与 Go model 对齐的 TS 类型
```

## 已知限制

- 实例状态（`Status` / `CurrentNodeID`）在后端没有「按实例 ID 查询」的接口，实例详情页是通过
  `GET /inst/start/by?userid=发起人` 反查得到的。若该发起人名下实例很多，这一步会拉取较多数据。
- 会签节点的「加签 / 减签」后端未提供接口，前端未实现。
- 流程图回显只区分「已完成 / 当前 / 驳回 / 未开始」四种状态，不展示每个节点的耗时统计。
- 示例事件（`example/event/ExampleEvent.go`）把角色硬编码成了内存里的「角色-用户」表
  （主管→张经理、人事经理→人事老刘、老板→李老板/老板娘、副总→赵总/钱总/孙总），
  测试时需要用这些用户名去查待办。
- 流程定义更新（同名同来源保存）只会保留最新版本的 `proc_execution`，
  已发起的旧版本实例会按新定义的节点流转 —— 这是引擎既有行为，前端未做规避。

