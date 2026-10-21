/**
 * 与 Go 后端 model 包一一对应的 TypeScript 类型定义。
 * 参考: workflow/model/*.go, workflow/database/tables.go
 *
 * 注意：后端使用 Go 的 encoding/json 直接反序列化结构体字段（未打 tag），
 * 因此字段名必须保持与 Go 结构体字段名一致（大小写敏感）。
 */

/** 节点类型 对应 model.NodeType */
export const NodeType = {
  /** 开始(根)节点，流程一旦开始该节点自动通过 */
  Root: 0,
  /** 任务节点，需要人完成的节点 */
  Task: 1,
  /** 混合网关：排他/并行/包含网关的混合体 */
  Gateway: 2,
  /** 结束节点，流程到达即完成 */
  End: 3,
} as const

export type NodeTypeValue = (typeof NodeType)[keyof typeof NodeType]

/** 对应 model.Condition：条件表达式 + 满足后跳转的节点 */
export interface GatewayCondition {
  Expression: string
  NodeID: string
}

/** 对应 model.HybridGateway */
export interface HybridGateway {
  /** 条件判断分支 */
  Conditions: GatewayCondition[] | null
  /** 必然执行的节点（并行分支） */
  InevitableNodes: string[] | null
  /** 0: 只要有一个上级节点完成即可往下走(包含网关) 1: 必须上级节点全部完成(并行网关) */
  WaitForAllPrevNode: number
}

/** 对应 model.Node */
export interface WorkflowNode {
  /** 节点ID，全局唯一 */
  NodeID: string
  /** 节点名称 */
  NodeName: string
  /** 节点类型 */
  NodeType: NodeTypeValue
  /** 上级节点ID集合 */
  PrevNodeIDs: string[] | null
  /** 节点处理人 */
  UserIDs: string[] | null
  /** 节点处理角色，需要 StartEvents 解析成 UserIDs */
  Roles: string[] | null
  /** 网关配置，仅 NodeType=2 时有值 */
  GWConfig: HybridGateway
  /** 是否会签 0:任意一人通过即可 1:会签 */
  IsCosigned: number
  /** 节点开始事件 */
  NodeStartEvents: string[] | null
  /** 节点结束事件 */
  NodeEndEvents: string[] | null
  /** 任务完成事件 */
  TaskFinishEvents: string[] | null
}

/** 对应 model.Process，即 /def/save 的 Resource 字段内容 */
export interface WorkflowProcess {
  ProcessName: string
  Source: string
  RevokeEvents: string[] | null
  Nodes: WorkflowNode[]
}

/** 对应 database.ProcDef */
export interface ProcDef {
  ID: number
  Name: string
  Version: number
  Resource: string
  UserID: string
  Source: string
  CreatTime: string
}

/** 对应 model.Instance */
export interface ProcInstance {
  ProcInstID: number
  ProcID: number
  ProcName: string
  ProcVersion: number
  BusinessID: string
  Starter: string
  CurrentNodeID: string
  CreateTime: string
  /** 0:未完成(审批中) 1:已完成(通过) 2:撤销 */
  Status: number
}

/** 任务状态 */
export const TaskStatus = {
  Initial: 0,
  Passed: 1,
  Rejected: 2,
} as const

/** 对应 model.Task */
export interface WorkflowTask {
  TaskID: number
  BusinessID: string
  Starter: string
  ProcID: number
  ProcName: string
  ProcInstID: number
  NodeID: string
  NodeName: string
  PrevNodeID: string
  IsCosigned: number
  BatchCode: string
  UserID: string
  Status: number
  IsFinished: number
  Comment: string
  ProcInstCreateTime: string | null
  CreateTime: string | null
  FinishedTime: string | null
  DueAt?: string | null
}

/** 对应 model.TaskAction：当前任务可以执行哪些操作 */
export interface TaskAction {
  CanPass: boolean
  CanReject: boolean
  CanFreeRejectToUpstreamNode: boolean
  CanDirectlyToWhoRejectedMe: boolean
  CanRevoke: boolean
}

/** 对应 model.Variable */
export interface WorkflowVariable {
  Key: string
  Value: string
}

/** 流程实例状态展示文案 */
export const INSTANCE_STATUS_TEXT: Record<number, string> = {
  0: '审批中',
  1: '已完成',
  2: '已撤销',
}

/** 任务状态展示文案 */
export const TASK_STATUS_TEXT: Record<number, string> = {
  0: '待处理',
  1: '已通过',
  2: '已驳回',
}
