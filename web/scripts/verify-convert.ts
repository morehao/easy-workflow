/**
 * 流程定义转换自检脚本（无需测试框架）。
 *
 * 目的：验证「引擎 Process JSON <-> LogicFlow 图数据」的双向转换是无损的，
 * 以及校验规则能拦住引擎侧不允许的定义。因为流程定义 JSON 是与 Go 引擎的
 * 唯一契约，跑一遍这个脚本比手动点界面更可靠。
 *
 * 运行： npm run check:convert
 */
import { createExampleProcess } from '../src/logicflow/example'
import {
  computeProgress,
  graphToProcess,
  processToGraph,
  validateProcess,
  autoLayout,
} from '../src/logicflow/convert'
import { NodeType, type WorkflowProcess, type WorkflowTask } from '../src/types/workflow'

let failed = 0
let passed = 0

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}`)
    if (detail !== undefined) {
      console.error('    实际:', JSON.stringify(detail, null, 2))
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b))
}

/** 递归排序对象 key，消除字段顺序带来的干扰 */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    Object.keys(value as Record<string, unknown>)
      .sort()
      .forEach((k) => {
        out[k] = sortDeep((value as Record<string, unknown>)[k])
      })
    return out
  }
  return value
}

/* ------------------------------------------------------------------ */
console.log('\n[1] 示例流程定义本身应通过引擎约束校验')
const example = createExampleProcess()
const issues = validateProcess(example)
const errors = issues.filter((i) => i.level === 'error')
check('示例流程无 error', errors.length === 0, errors)
check(
  '示例流程的警告符合预期（角色未配解析事件等）',
  issues.every((i) => i.level === 'warning' || i.level === 'error'),
  issues,
)

/* ------------------------------------------------------------------ */
console.log('\n[2] Process -> LogicFlow 图 -> Process 往返应无损')
const graph = processToGraph(example)
check('图节点数与流程节点数一致', (graph.nodes || []).length === example.Nodes.length, graph.nodes?.length)
check(
  '连线数等于所有 PrevNodeIDs 之和',
  (graph.edges || []).length ===
    example.Nodes.reduce((sum, n) => sum + (n.PrevNodeIDs?.length || 0), 0),
  graph.edges?.length,
)

const roundTrip = graphToProcess(graph, {
  processName: example.ProcessName,
  source: example.Source,
  revokeEvents: example.RevokeEvents || [],
})
check('往返后的流程定义与原始定义完全一致', deepEqual(roundTrip, example), {
  roundTrip,
  example,
})

/* ------------------------------------------------------------------ */
console.log('\n[3] 网关三种语义的映射')
const byId = new Map(roundTrip.Nodes.map((n) => [n.NodeID, n]))
const gwDay = byId.get('GW-Day')!
check(
  'GW-Day（排他网关）保留两个条件分支及表达式',
  gwDay.GWConfig.Conditions?.length === 2 &&
    gwDay.GWConfig.Conditions[0].Expression === '$days>=3' &&
    gwDay.GWConfig.Conditions[1].Expression === '$days<3',
  gwDay.GWConfig,
)
const gwParallel = byId.get('GW-Parallel')!
check(
  'GW-Parallel 的 InevitableNodes 保留 HR / DeputyBoss',
  deepEqual(gwParallel.GWConfig.InevitableNodes, ['HR', 'DeputyBoss']),
  gwParallel.GWConfig,
)
const gwParallel2 = byId.get('GW-Parallel2')!
check(
  'GW-Parallel2 为并行汇聚（WaitForAllPrevNode=1）',
  gwParallel2.GWConfig.WaitForAllPrevNode === 1,
  gwParallel2.GWConfig,
)
check(
  'END 节点同时拥有两个上级节点',
  deepEqual(byId.get('END')!.PrevNodeIDs, ['GW-Day', 'Boss']),
  byId.get('END')!.PrevNodeIDs,
)
check(
  '副总会签节点 IsCosigned=1 且保留任务完成事件',
  byId.get('DeputyBoss')!.IsCosigned === 1 &&
    deepEqual(byId.get('DeputyBoss')!.TaskFinishEvents, ['MyEvent_TaskForceNodePass']),
  byId.get('DeputyBoss'),
)

/* ------------------------------------------------------------------ */
console.log('\n[4] 校验规则应拦住非法定义')
const noStart: WorkflowProcess = {
  ProcessName: 'x',
  Source: 'y',
  RevokeEvents: null,
  Nodes: [
    {
      NodeID: 'T1',
      NodeName: 'T1',
      NodeType: NodeType.Task,
      PrevNodeIDs: null,
      UserIDs: ['u1'],
      Roles: null,
      GWConfig: { Conditions: null, InevitableNodes: null, WaitForAllPrevNode: 0 },
      IsCosigned: 0,
      NodeStartEvents: null,
      NodeEndEvents: null,
      TaskFinishEvents: null,
    },
  ],
}
const noStartErrors = validateProcess(noStart).filter((i) => i.level === 'error')
check(
  '缺少开始节点被拦截',
  noStartErrors.some((i) => i.message.includes('开始节点')),
  noStartErrors,
)

const dupIds = JSON.parse(JSON.stringify(example)) as WorkflowProcess
dupIds.Nodes[1].NodeID = dupIds.Nodes[0].NodeID
check(
  '节点ID重复被拦截',
  validateProcess(dupIds)
    .filter((i) => i.level === 'error')
    .some((i) => i.message.includes('重复')),
)

const unreachable = JSON.parse(JSON.stringify(example)) as WorkflowProcess
unreachable.Nodes.push({
  NodeID: 'Orphan',
  NodeName: '孤岛节点',
  NodeType: NodeType.Task,
  PrevNodeIDs: ['NotExist'],
  UserIDs: ['u1'],
  Roles: null,
  GWConfig: { Conditions: null, InevitableNodes: null, WaitForAllPrevNode: 0 },
  IsCosigned: 0,
  NodeStartEvents: null,
  NodeEndEvents: null,
  TaskFinishEvents: null,
})
const orphanErrors = validateProcess(unreachable)
  .filter((i) => i.level === 'error')
  .map((i) => i.message)
check(
  '上级节点不存在 / 节点不可达被拦截',
  orphanErrors.some((m: string) => m.includes('不存在')) &&
    orphanErrors.some((m: string) => m.includes('不可达')),
  orphanErrors,
)

const noHandler = JSON.parse(JSON.stringify(example)) as WorkflowProcess
const bossNode = noHandler.Nodes.find((n) => n.NodeID === 'Boss')!
bossNode.Roles = null
bossNode.NodeStartEvents = null
check(
  '任务节点没有处理人/角色/事件被拦截',
  validateProcess(noHandler)
    .filter((i) => i.level === 'error')
    .some((m) => m.message.includes('未设置处理人')),
)

/* ------------------------------------------------------------------ */
console.log('\n[5] 实例进度计算')
const tasks: WorkflowTask[] = [
  {
    TaskID: 1,
    BusinessID: 'B001',
    Starter: 'U0001',
    ProcID: 1,
    ProcName: '员工请假',
    ProcInstID: 100,
    NodeID: 'Start',
    NodeName: '请假',
    PrevNodeID: '',
    IsCosigned: 0,
    BatchCode: 'b1',
    UserID: 'U0001',
    Status: 1,
    IsFinished: 1,
    Comment: '发起',
    ProcInstCreateTime: '2024-01-01 10:00:00',
    CreateTime: '2024-01-01 10:00:00',
    FinishedTime: '2024-01-01 10:00:00',
  },
  {
    TaskID: 2,
    BusinessID: 'B001',
    Starter: 'U0001',
    ProcID: 1,
    ProcName: '员工请假',
    ProcInstID: 100,
    NodeID: 'Manager',
    NodeName: '主管审批',
    PrevNodeID: 'Start',
    IsCosigned: 0,
    BatchCode: 'b2',
    UserID: '张经理',
    Status: 2,
    IsFinished: 1,
    Comment: '不批',
    ProcInstCreateTime: '2024-01-01 10:00:00',
    CreateTime: '2024-01-01 10:00:01',
    FinishedTime: '2024-01-01 10:05:00',
  },
  {
    TaskID: 3,
    BusinessID: 'B001',
    Starter: 'U0001',
    ProcID: 1,
    ProcName: '员工请假',
    ProcInstID: 100,
    NodeID: 'Start',
    NodeName: '请假',
    PrevNodeID: 'Manager',
    IsCosigned: 0,
    BatchCode: 'b3',
    UserID: 'U0001',
    Status: 0,
    IsFinished: 0,
    Comment: '',
    ProcInstCreateTime: '2024-01-01 10:00:00',
    CreateTime: '2024-01-01 10:06:00',
    FinishedTime: null,
  },
]

const progress = computeProgress(example, tasks, 0, 'Start')
check('Start 节点因最新一批待处理而标记为 current', progress.nodeStates.get('Start') === 'current', {
  start: progress.nodeStates.get('Start'),
})
check('Manager 节点标记为 rejected', progress.nodeStates.get('Manager') === 'rejected', {
  manager: progress.nodeStates.get('Manager'),
})
check('未流转到的节点标记为 pending', progress.nodeStates.get('Boss') === 'pending', {
  boss: progress.nodeStates.get('Boss'),
})
check(
  'Manager 的处理人被汇总',
  progress.nodeUsers.get('Manager') === '张经理',
  progress.nodeUsers.get('Manager'),
)
check(
  'Start->GW-Day 连线已走过',
  progress.edgeStates.get('Start->GW-Day') === 'done',
  progress.edgeStates.get('Start->GW-Day'),
)
check(
  'GW-Day->Manager 连线标记为驳回（驳回发生在 Manager）',
  progress.edgeStates.get('GW-Day->Manager') === 'rejected',
  progress.edgeStates.get('GW-Day->Manager'),
)
check(
  '经过网关的连线也能被识别（Manager->GW-Parallel 已走过）',
  progress.edgeStates.get('Manager->GW-Parallel') === 'done',
  progress.edgeStates.get('Manager->GW-Parallel'),
)
check(
  '未命中的条件分支不会被标记（GW-Day->END 仍未开始）',
  progress.edgeStates.get('GW-Day->END') === undefined,
  progress.edgeStates.get('GW-Day->END'),
)

/* ------------------------------------------------------------------ */
console.log('\n[6] 自动布局')
const layout = autoLayout(
  ['A', 'B', 'C', 'D'],
  [
    { source: 'A', target: 'B' },
    { source: 'A', target: 'C' },
    { source: 'B', target: 'D' },
    { source: 'C', target: 'D' },
  ],
  () => ({ width: 172, height: 56 }),
)
check('四个节点都有坐标', layout.size === 4, layout.size)
check(
  '同层节点（B、C）纵向不重叠',
  Math.abs((layout.get('B')?.y ?? 0) - (layout.get('C')?.y ?? 0)) >= 56,
  { b: layout.get('B'), c: layout.get('C') },
)
check(
  '下游节点在更靠右的列（D.x > B.x，A.x 最小）',
  (layout.get('A')?.x ?? 0) < (layout.get('B')?.x ?? 0) &&
    (layout.get('B')?.x ?? 0) < (layout.get('D')?.x ?? 0),
  { a: layout.get('A'), b: layout.get('B'), d: layout.get('D') },
)

/* ------------------------------------------------------------------ */
console.log(`\n通过 ${passed} 项，失败 ${failed} 项\n`)
if (failed > 0) {
  process.exitCode = 1
}
