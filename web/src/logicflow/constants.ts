import { NodeType, type NodeTypeValue } from '@/types/workflow'

/** LogicFlow 中注册的节点类型名 */
export const LF_NODE_TYPE = {
  start: 'wf-start',
  task: 'wf-task',
  gateway: 'wf-gateway',
  end: 'wf-end',
} as const

export type LfNodeType = (typeof LF_NODE_TYPE)[keyof typeof LF_NODE_TYPE]

/** 引擎节点类型 -> LogicFlow 节点类型 */
export function engineTypeToLf(t: NodeTypeValue): LfNodeType {
  switch (t) {
    case NodeType.Root:
      return LF_NODE_TYPE.start
    case NodeType.Task:
      return LF_NODE_TYPE.task
    case NodeType.Gateway:
      return LF_NODE_TYPE.gateway
    case NodeType.End:
      return LF_NODE_TYPE.end
    default:
      return LF_NODE_TYPE.task
  }
}

/** LogicFlow 节点类型 -> 引擎节点类型 */
export function lfTypeToEngine(type: string): NodeTypeValue {
  switch (type) {
    case LF_NODE_TYPE.start:
      return NodeType.Root
    case LF_NODE_TYPE.gateway:
      return NodeType.Gateway
    case LF_NODE_TYPE.end:
      return NodeType.End
    default:
      return NodeType.Task
  }
}

/** 网关语义模式（编辑器概念，导出时映射为 GWConfig） */
export type GwMode = 'exclusive' | 'parallel' | 'inclusive'

export const GW_MODE_OPTIONS: { label: string; value: GwMode; tip: string }[] = [
  {
    label: '排他网关（条件分支）',
    value: 'exclusive',
    tip: '按出线条件表达式决定走哪一条分支，等价 activiti 的 ExclusiveGateway',
  },
  {
    label: '并行网关（全部执行）',
    value: 'parallel',
    tip: '所有下级节点全部执行；waitForAllPrevNode=1，等价 activiti 的 ParallelGateway',
  },
  {
    label: '包含网关（混合）',
    value: 'inclusive',
    tip: '出线可标记“必然执行”或“条件执行”，是排他与并行的混合体',
  },
]

/** 出线分支语义 */
export type BranchKind = 'condition' | 'inevitable'

/** 视图进度状态，用于流程图回显 */
export type ProgressState = 'pending' | 'done' | 'current' | 'rejected'

/** 节点上保存的业务属性 */
export interface WfNodeProperties {
  /** 引擎节点ID（全局唯一，导出为 Node.NodeID） */
  nodeId: string
  /** 节点名称，导出为 Node.NodeName */
  nodeName: string
  /** 处理人 */
  userIds: string[]
  /** 处理角色，需配合节点开始事件解析 */
  roles: string[]
  /** 是否会签 0/1 */
  isCosigned: number
  /** 节点开始事件 */
  nodeStartEvents: string[]
  /** 节点结束事件 */
  nodeEndEvents: string[]
  /** 任务完成事件 */
  taskFinishEvents: string[]
  /** 网关语义模式，仅网关节点使用 */
  gwMode?: GwMode
  /** 是否等待所有上级节点完成，仅网关节点使用 */
  waitForAllPrevNode?: number
  /** 只读视图进度状态 */
  progressState?: ProgressState
  /** 只读视图：该节点上的处理人汇总 */
  progressUsers?: string
  [key: string]: unknown
}

/** 边上保存的业务属性 */
export interface WfEdgeProperties {
  /** 分支语义 */
  branchKind: BranchKind
  /** 条件表达式，如 $days>=3 */
  expression: string
  /** 只读视图进度状态 */
  progressState?: ProgressState
  [key: string]: unknown
}

/** 节点配色 */
export const NODE_COLORS: Record<
  LfNodeType,
  { fill: string; stroke: string; text: string; label: string; hint: string }
> = {
  [LF_NODE_TYPE.start]: {
    fill: '#e9f7ef',
    stroke: '#2f9e44',
    text: '#1b5e20',
    label: '开始节点',
    hint: '流程发起节点，开始后自动通过，通常处理人填 $starter',
  },
  [LF_NODE_TYPE.task]: {
    fill: '#eaf2ff',
    stroke: '#2b6cb0',
    text: '#1a365d',
    label: '任务节点',
    hint: '需要人处理的审批节点',
  },
  [LF_NODE_TYPE.gateway]: {
    fill: '#fff7e6',
    stroke: '#d69e2e',
    text: '#7b341e',
    label: '网关节点',
    hint: '混合网关，控制流程走向',
  },
  [LF_NODE_TYPE.end]: {
    fill: '#fdecec',
    stroke: '#c92a2a',
    text: '#7f1d1d',
    label: '结束节点',
    hint: '流程到达该节点即完成',
  },
}

/** 进度状态配色（只读视图使用） */
export const PROGRESS_COLORS: Record<ProgressState, { fill: string; stroke: string; strokeWidth: number }> = {
  pending: { fill: '#ffffff', stroke: '#d9d9d9', strokeWidth: 1.5 },
  done: { fill: '#f6ffed', stroke: '#52c41a', strokeWidth: 2 },
  current: { fill: '#e6f4ff', stroke: '#1677ff', strokeWidth: 3 },
  rejected: { fill: '#fff1f0', stroke: '#ff4d4f', strokeWidth: 2 },
}

/** 进度状态文案 */
export const PROGRESS_TEXT: Record<ProgressState, string> = {
  pending: '未开始',
  done: '已完成',
  current: '进行中',
  rejected: '已驳回',
}

/** 编辑器调色板（左侧可拖拽项） */
export const PALETTE_ITEMS: {
  type: LfNodeType
  label: string
  text: string
  description: string
  color: string
}[] = [
  {
    type: LF_NODE_TYPE.start,
    label: '开始节点',
    text: '开始',
    description: '流程发起，唯一的入口',
    color: NODE_COLORS[LF_NODE_TYPE.start].stroke,
  },
  {
    type: LF_NODE_TYPE.task,
    label: '任务节点',
    text: '审批节点',
    description: '需要人处理的节点，可会签',
    color: NODE_COLORS[LF_NODE_TYPE.task].stroke,
  },
  {
    type: LF_NODE_TYPE.gateway,
    label: '网关节点',
    text: '网关',
    description: '排他 / 并行 / 包含网关',
    color: NODE_COLORS[LF_NODE_TYPE.gateway].stroke,
  },
  {
    type: LF_NODE_TYPE.end,
    label: '结束节点',
    text: '结束',
    description: '流程终点，到达即完成',
    color: NODE_COLORS[LF_NODE_TYPE.end].stroke,
  },
]
