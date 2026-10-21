import type LogicFlow from '@logicflow/core'
import {
  NodeType,
  type GatewayCondition,
  type HybridGateway,
  type NodeTypeValue,
  type WorkflowNode,
  type WorkflowProcess,
  type WorkflowTask,
} from '@/types/workflow'
import {
  engineTypeToLf,
  lfTypeToEngine,
  LF_NODE_TYPE,
  type GwMode,
  type LfNodeType,
  type ProgressState,
  type WfEdgeProperties,
  type WfNodeProperties,
} from './constants'

/** LogicFlow 节点尺寸（自动布局使用） */
const NODE_SIZE: Record<LfNodeType, { width: number; height: number }> = {
  [LF_NODE_TYPE.start]: { width: 68, height: 68 },
  [LF_NODE_TYPE.task]: { width: 172, height: 56 },
  [LF_NODE_TYPE.gateway]: { width: 148, height: 92 },
  [LF_NODE_TYPE.end]: { width: 68, height: 68 },
}

/* -------------------------------------------------------------------------- */
/* 工具                                                                        */
/* -------------------------------------------------------------------------- */

function uniq<T>(list: T[]): T[] {
  return Array.from(new Set(list))
}

/** 数组去空 + 去重，空数组统一转成 null（与 Go 的 nil 语义对齐） */
function normalizeList(list: string[] | null | undefined): string[] | null {
  const arr = (list || []).map((s) => (s ?? '').trim()).filter((s) => s.length > 0)
  return arr.length ? uniq(arr) : null
}

function emptyGateway(): HybridGateway {
  return { Conditions: null, InevitableNodes: null, WaitForAllPrevNode: 0 }
}

/** 从引擎的 GWConfig 反推编辑器使用的网关模式 */
function inferGwMode(gw: HybridGateway | undefined): GwMode {
  const hasConditions = !!gw?.Conditions?.length
  const hasInevitable = !!gw?.InevitableNodes?.length
  if (hasConditions && hasInevitable) return 'inclusive'
  if (hasConditions) return 'exclusive'
  if (hasInevitable) return gw?.WaitForAllPrevNode === 1 ? 'parallel' : 'inclusive'
  return 'exclusive'
}

/**
 * 计算节点的默认 NodeID：Task_1 / GW_2 / Start / End
 */
export function nextNodeId(type: LfNodeType, existing: Iterable<string>): string {
  const used = new Set(existing)
  if (type === LF_NODE_TYPE.start) {
    return used.has('Start') ? 'Start_1' : 'Start'
  }
  if (type === LF_NODE_TYPE.end) {
    if (!used.has('End')) return 'End'
    let i = 1
    while (used.has(`End_${i}`)) i += 1
    return `End_${i}`
  }
  const prefix = type === LF_NODE_TYPE.gateway ? 'GW' : 'Task'
  let i = 1
  while (used.has(`${prefix}_${i}`)) i += 1
  return `${prefix}_${i}`
}

/** 生成一个稳定的 LogicFlow 节点 id */
export function makeLfNodeId(index: number): string {
  return `lf_node_${index}`
}

/* -------------------------------------------------------------------------- */
/* LogicFlow GraphData -> 引擎 Process JSON                                    */
/* -------------------------------------------------------------------------- */

export interface DesignerMeta {
  processName: string
  source: string
  revokeEvents: string[]
}

type LfNode = LogicFlow.NodeConfig & { id: string }
type LfEdge = LogicFlow.EdgeConfig & { id: string }

function textValue(text: LogicFlow.NodeConfig['text']): string {
  if (!text) return ''
  if (typeof text === 'string') return text
  return text.value ?? ''
}

/**
 * 把 LogicFlow 的画布数据转换为后端 /def/save 需要的 Process JSON。
 *
 * 关键映射：
 *  - 画布节点的 properties.nodeId -> Node.NodeID
 *  - 画布连线 -> Node.PrevNodeIDs（谁是我的上级）
 *  - 网关出线 + 出线属性 -> GWConfig.Conditions / InevitableNodes / WaitForAllPrevNode
 */
export function graphToProcess(graph: LogicFlow.GraphConfigData, meta: DesignerMeta): WorkflowProcess {
  // GraphConfigData 里 id 是可选字段，但 LogicFlow 实际产出的数据一定有 id，这里收敛一次类型
  const lfNodes = (graph.nodes ?? []).filter((n): n is LfNode => typeof n.id === 'string')
  const lfEdges = (graph.edges ?? []).filter((e): e is LfEdge => typeof e.id === 'string')

  /** lf 节点 id -> 引擎 NodeID */
  const idMap = new Map<string, string>()
  lfNodes.forEach((n) => {
    const props = (n.properties || {}) as WfNodeProperties
    idMap.set(n.id, (props.nodeId || n.id).trim())
  })

  const engineId = (lfId: string) => idMap.get(lfId) || lfId

  // ---- 出边 / 入边索引 ----
  const outEdges = new Map<string, LogicFlow.EdgeConfig[]>()
  const inEdges = new Map<string, LogicFlow.EdgeConfig[]>()
  lfEdges.forEach((e) => {
    if (!outEdges.has(e.sourceNodeId)) outEdges.set(e.sourceNodeId, [])
    outEdges.get(e.sourceNodeId)!.push(e)
    if (!inEdges.has(e.targetNodeId)) inEdges.set(e.targetNodeId, [])
    inEdges.get(e.targetNodeId)!.push(e)
  })

  const nodes: WorkflowNode[] = lfNodes.map((n) => {
    const props = (n.properties || {}) as WfNodeProperties
    const nodeType = lfTypeToEngine(n.type) as NodeTypeValue
    const nodeId = engineId(n.id)

    const prevNodeIDs =
      nodeType === NodeType.Root
        ? null
        : normalizeList((inEdges.get(n.id) || []).map((e) => engineId(e.sourceNodeId)))

    const base: WorkflowNode = {
      NodeID: nodeId,
      NodeName: (props.nodeName || textValue(n.text) || nodeId).trim(),
      NodeType: nodeType,
      PrevNodeIDs: prevNodeIDs,
      UserIDs: null,
      Roles: null,
      GWConfig: emptyGateway(),
      IsCosigned: 0,
      NodeStartEvents: normalizeList(props.nodeStartEvents),
      NodeEndEvents: normalizeList(props.nodeEndEvents),
      TaskFinishEvents: normalizeList(props.taskFinishEvents),
    }

    if (nodeType === NodeType.Task || nodeType === NodeType.Root) {
      base.UserIDs = normalizeList(props.userIds)
      base.Roles = normalizeList(props.roles)
      base.IsCosigned = nodeType === NodeType.Task && props.isCosigned ? 1 : 0
    }

    if (nodeType === NodeType.Gateway) {
      const out = outEdges.get(n.id) || []
      const gwMode: GwMode = props.gwMode || 'exclusive'
      const conditions: GatewayCondition[] = []
      const inevitable: string[] = []

      out.forEach((e) => {
        const eProps = (e.properties || {}) as WfEdgeProperties
        const target = engineId(e.targetNodeId)
        const expression = (eProps.expression || textValue(e.text) || '').trim()
        // 并行网关：所有出线必然执行
        // 排他/包含网关：依据出线属性判断，没打标记时按“有表达式即条件分支”兜底
        const kind =
          gwMode === 'parallel'
            ? 'inevitable'
            : gwMode === 'exclusive'
              ? 'condition'
              : eProps.branchKind || (expression ? 'condition' : 'inevitable')

        if (kind === 'condition') {
          conditions.push({ Expression: expression, NodeID: target })
        } else {
          inevitable.push(target)
        }
      })

      base.GWConfig = {
        Conditions: conditions.length ? conditions : null,
        InevitableNodes: normalizeList(inevitable),
        WaitForAllPrevNode: gwMode === 'parallel' ? 1 : (props.waitForAllPrevNode ?? 0) ? 1 : 0,
      }
    }

    if (nodeType === NodeType.End) {
      base.UserIDs = null
      base.Roles = null
      base.IsCosigned = 0
      base.NodeEndEvents = null
      base.TaskFinishEvents = null
    }

    return base
  })

  return {
    ProcessName: meta.processName.trim(),
    Source: meta.source.trim(),
    RevokeEvents: normalizeList(meta.revokeEvents),
    Nodes: nodes,
  }
}

/* -------------------------------------------------------------------------- */
/* 引擎 Process JSON -> LogicFlow GraphData                                    */
/* -------------------------------------------------------------------------- */

export interface LayoutOptions {
  /** 起始 X */
  originX?: number
  /** 起始 Y */
  originY?: number
  /** 列宽 */
  columnGap?: number
  /** 行高 */
  rowGap?: number
}

/**
 * 简单的分层（从左到右）自动布局。
 * 引擎的流程定义只保存拓扑关系，不保存坐标，因此导入时必须自行布局。
 */
export function autoLayout(
  nodeIds: string[],
  edges: { source: string; target: string }[],
  sizeOf: (id: string) => { width: number; height: number },
  options: LayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const { originX = 110, originY = 90, columnGap = 80, rowGap = 36 } = options

  const indegree = new Map<string, number>()
  const children = new Map<string, string[]>()
  nodeIds.forEach((id) => {
    indegree.set(id, 0)
    children.set(id, [])
  })
  edges.forEach((e) => {
    if (!indegree.has(e.source) || !indegree.has(e.target)) return
    indegree.set(e.target, (indegree.get(e.target) || 0) + 1)
    children.get(e.source)!.push(e.target)
  })

  // ---- 计算层级：depth = max(前驱 depth) + 1 ----
  const depth = new Map<string, number>()
  const queue: string[] = []
  nodeIds.forEach((id) => {
    if ((indegree.get(id) || 0) === 0) {
      depth.set(id, 0)
      queue.push(id)
    }
  })
  // 全部节点都有前驱时（异常定义），从第一个节点兜底
  if (!queue.length && nodeIds.length) {
    depth.set(nodeIds[0], 0)
    queue.push(nodeIds[0])
  }

  const remaining = new Map(indegree)
  let guard = 0
  while (queue.length && guard < nodeIds.length * nodeIds.length + 16) {
    guard += 1
    const id = queue.shift()!
    const d = depth.get(id) ?? 0
    for (const child of children.get(id) || []) {
      depth.set(child, Math.max(depth.get(child) ?? 0, d + 1))
      remaining.set(child, (remaining.get(child) || 0) - 1)
      if ((remaining.get(child) || 0) <= 0 && !queue.includes(child)) {
        queue.push(child)
      }
    }
  }
  // 环路兜底：未计算到的节点放到最后一层
  let maxDepth = 0
  depth.forEach((d) => {
    maxDepth = Math.max(maxDepth, d)
  })
  nodeIds.forEach((id) => {
    if (!depth.has(id)) depth.set(id, maxDepth + 1)
  })

  // ---- 分层 ----
  const layers = new Map<number, string[]>()
  nodeIds.forEach((id) => {
    const d = depth.get(id) || 0
    if (!layers.has(d)) layers.set(d, [])
    layers.get(d)!.push(id)
  })

  // ---- 同层按前驱顺序排序，减少交叉 ----
  const orderIndex = new Map<string, number>()
  nodeIds.forEach((id, i) => orderIndex.set(id, i))
  const parents = new Map<string, string[]>()
  nodeIds.forEach((id) => parents.set(id, []))
  edges.forEach((e) => {
    if (!parents.has(e.target)) return
    parents.get(e.target)!.push(e.source)
  })

  const sortedDepths = Array.from(layers.keys()).sort((a, b) => a - b)

  // 第一轮：计算每列的宽度、高度以及节点在列内的相对纵向位置（以列中心为 0）
  type Placement = { id: string; relY: number; columnIndex: number }
  const placements: Placement[] = []
  const columnWidths: number[] = []

  sortedDepths.forEach((d, columnIndex) => {
    const ids = layers.get(d)!
    ids.sort((a, b) => {
      const pa = parents.get(a) || []
      const pb = parents.get(b) || []
      const oa = pa.length ? Math.min(...pa.map((p) => orderIndex.get(p) ?? 0)) : (orderIndex.get(a) ?? 0)
      const ob = pb.length ? Math.min(...pb.map((p) => orderIndex.get(p) ?? 0)) : (orderIndex.get(b) ?? 0)
      return oa - ob
    })

    const sizes = ids.map((id) => sizeOf(id))
    const totalHeight =
      sizes.reduce((sum, s) => sum + s.height, 0) + rowGap * Math.max(0, ids.length - 1)

    let cursor = -totalHeight / 2
    ids.forEach((id, i) => {
      placements.push({ id, relY: cursor + sizes[i].height / 2, columnIndex })
      cursor += sizes[i].height + rowGap
    })
    columnWidths[columnIndex] = Math.max(...sizes.map((s) => s.width), 1)
  })

  // 第二轮：换算为绝对坐标（各列纵向居中对齐，整体平移到 originX/originY）
  const columnX: number[] = []
  let cursorX = 0
  columnWidths.forEach((w, i) => {
    columnX[i] = cursorX + w / 2
    cursorX += w + columnGap
  })

  const result = new Map<string, { x: number; y: number }>()
  placements.forEach((p) => {
    result.set(p.id, {
      x: columnX[p.columnIndex] + originX,
      y: p.relY + originY,
    })
  })

  return result
}

export interface ProcessToGraphOptions extends LayoutOptions {
  /** 只读视图使用：标记进度状态 */
  nodeStates?: Map<string, ProgressState>
  edgeStates?: Map<string, ProgressState>
  nodeUsers?: Map<string, string>
  /** 是否把节点名称作为画布文本（默认 true） */
  useNodeNameAsText?: boolean
}

type EdgeKey = `${string}->${string}`

export function edgeKey(source: string, target: string): EdgeKey {
  return `${source}->${target}`
}

/**
 * 把引擎的 Process JSON 还原成 LogicFlow 图数据。
 */
export function processToGraph(
  process: WorkflowProcess,
  options: ProcessToGraphOptions = {},
): LogicFlow.GraphConfigData {
  const engineNodes = process.Nodes || []
  const byEngineId = new Map<string, WorkflowNode>()
  engineNodes.forEach((n) => byEngineId.set(n.NodeID, n))

  // ---- 组装节点 ----
  const lfIdOf = new Map<string, string>()
  const engineIdOf = new Map<string, string>()
  engineNodes.forEach((n, i) => {
    const lfId = makeLfNodeId(i)
    lfIdOf.set(n.NodeID, lfId)
    engineIdOf.set(lfId, n.NodeID)
  })

  const sizeOf = (lfId: string) => {
    const engineId = engineIdOf.get(lfId)
    const engineNode = engineId ? byEngineId.get(engineId) : undefined
    const type = engineNode ? engineTypeToLf(engineNode.NodeType) : LF_NODE_TYPE.task
    return NODE_SIZE[type]
  }

  const edges: { source: string; target: string }[] = []
  engineNodes.forEach((n) => {
    ;(n.PrevNodeIDs || []).forEach((prev) => {
      if (!byEngineId.has(prev)) return
      edges.push({ source: lfIdOf.get(prev)!, target: lfIdOf.get(n.NodeID)! })
    })
  })

  const positions = autoLayout(
    engineNodes.map((n) => lfIdOf.get(n.NodeID)!),
    edges,
    sizeOf,
    options,
  )

  const nodes = engineNodes.map((n) => {
    const lfId = lfIdOf.get(n.NodeID)!
    const type = engineTypeToLf(n.NodeType)
    const properties: WfNodeProperties = {
      nodeId: n.NodeID,
      nodeName: n.NodeName,
      userIds: n.UserIDs || [],
      roles: n.Roles || [],
      isCosigned: n.IsCosigned || 0,
      nodeStartEvents: n.NodeStartEvents || [],
      nodeEndEvents: n.NodeEndEvents || [],
      taskFinishEvents: n.TaskFinishEvents || [],
    }
    if (n.NodeType === NodeType.Gateway) {
      properties.gwMode = inferGwMode(n.GWConfig)
      properties.waitForAllPrevNode = n.GWConfig?.WaitForAllPrevNode || 0
    }
    const state = options.nodeStates?.get(n.NodeID)
    if (state) properties.progressState = state
    const users = options.nodeUsers?.get(n.NodeID)
    if (users) properties.progressUsers = users

    const pos = positions.get(lfId) || { x: 0, y: 0 }
    return {
      id: lfId,
      type,
      x: pos.x,
      y: pos.y,
      text: options.useNodeNameAsText === false ? n.NodeID : n.NodeName,
      properties,
    }
  })

  // ---- 组装连线 ----
  const lfEdges = engineNodes.flatMap((n) => {
    const target = lfIdOf.get(n.NodeID)!
    return (n.PrevNodeIDs || [])
      .filter((prev) => byEngineId.has(prev))
      .map((prev, idx) => {
        const source = lfIdOf.get(prev)!
        const sourceNode = byEngineId.get(prev)!
        const edgeProperties: WfEdgeProperties = { branchKind: 'inevitable', expression: '' }

        if (sourceNode.NodeType === NodeType.Gateway) {
          const condition = (sourceNode.GWConfig?.Conditions || []).find((c) => c.NodeID === n.NodeID)
          if (condition) {
            edgeProperties.branchKind = 'condition'
            edgeProperties.expression = condition.Expression
          } else if ((sourceNode.GWConfig?.InevitableNodes || []).includes(n.NodeID)) {
            edgeProperties.branchKind = 'inevitable'
          } else if (sourceNode.GWConfig?.WaitForAllPrevNode === 1) {
            edgeProperties.branchKind = 'inevitable'
          }
        }

        const state = options.edgeStates?.get(edgeKey(prev, n.NodeID))
        if (state) edgeProperties.progressState = state

        return {
          // 同一对节点之间理论上只会有一条连线；用序号兜底保证 id 唯一
          id: `lf_edge_${prev}_${n.NodeID}_${idx}`,
          type: 'polyline',
          sourceNodeId: source,
          targetNodeId: target,
          text: edgeProperties.expression || '',
          properties: edgeProperties,
        }
      })
  })

  return { nodes, edges: lfEdges }
}

/* -------------------------------------------------------------------------- */
/* 校验                                                                        */
/* -------------------------------------------------------------------------- */

export interface ValidationIssue {
  level: 'error' | 'warning'
  message: string
  nodeId?: string
}

/**
 * 校验流程定义是否符合引擎的约束。
 * 引擎侧没有做太多校验（ProcessDefine.go 里还留着 TODO），所以前端要把好关。
 */
export function validateProcess(process: WorkflowProcess): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const nodes = process.Nodes || []

  if (!process.ProcessName?.trim()) {
    issues.push({ level: 'error', message: '流程名称不能为空' })
  }
  if (!process.Source?.trim()) {
    issues.push({ level: 'error', message: '流程来源(Source)不能为空' })
  }

  // ---- 节点ID 唯一性 ----
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  nodes.forEach((n) => {
    const id = (n.NodeID || '').trim()
    if (!id) {
      issues.push({ level: 'error', message: '存在未填写节点ID的节点' })
      return
    }
    if (seen.has(id)) duplicated.add(id)
    seen.add(id)
  })
  duplicated.forEach((id) => {
    issues.push({ level: 'error', message: `节点ID重复：${id}`, nodeId: id })
  })

  const byId = new Map(nodes.map((n) => [n.NodeID, n]))

  // ---- 起止节点 ----
  const startNodes = nodes.filter((n) => n.NodeType === NodeType.Root)
  const endNodes = nodes.filter((n) => n.NodeType === NodeType.End)
  if (startNodes.length === 0) {
    issues.push({ level: 'error', message: '流程必须包含一个开始节点' })
  }
  if (startNodes.length > 1) {
    issues.push({ level: 'error', message: `流程只能有一个开始节点，当前有 ${startNodes.length} 个` })
  }
  if (endNodes.length === 0) {
    issues.push({ level: 'warning', message: '流程没有结束节点，分支走到底可能会卡住（引擎不会自动结束流程）' })
  }

  // ---- 连通性 / 上级节点 ----
  const outgoing = new Map<string, string[]>()
  nodes.forEach((n) => outgoing.set(n.NodeID, []))
  nodes.forEach((n) => {
    ;(n.PrevNodeIDs || []).forEach((prev) => {
      if (!byId.has(prev)) {
        issues.push({
          level: 'error',
          message: `节点[${n.NodeID}]的上级节点[${prev}]不存在`,
          nodeId: n.NodeID,
        })
        return
      }
      outgoing.get(prev)!.push(n.NodeID)
    })
  })

  nodes.forEach((n) => {
    const label = n.NodeName || n.NodeID
    if (n.NodeType === NodeType.Root) {
      if ((n.PrevNodeIDs || []).length) {
        issues.push({ level: 'error', message: `开始节点[${label}]不能有上级节点`, nodeId: n.NodeID })
      }
      if (!(outgoing.get(n.NodeID) || []).length) {
        issues.push({ level: 'error', message: `开始节点[${label}]没有下级节点`, nodeId: n.NodeID })
      }
    } else if (n.NodeType === NodeType.End) {
      if ((outgoing.get(n.NodeID) || []).length) {
        issues.push({ level: 'error', message: `结束节点[${label}]不能有下级节点`, nodeId: n.NodeID })
      }
      if (!(n.PrevNodeIDs || []).length) {
        issues.push({ level: 'error', message: `结束节点[${label}]没有上级节点`, nodeId: n.NodeID })
      }
    } else if (!(n.PrevNodeIDs || []).length) {
      issues.push({ level: 'error', message: `节点[${label}]没有上级节点，流程无法流转到该节点`, nodeId: n.NodeID })
    }

    if (n.NodeType === NodeType.Task) {
      const hasUser = !!(n.UserIDs || []).length
      const hasRole = !!(n.Roles || []).length
      const hasStartEvent = !!(n.NodeStartEvents || []).length
      if (!hasUser && !hasRole && !hasStartEvent) {
        issues.push({
          level: 'error',
          message: `任务节点[${label}]未设置处理人、角色或节点开始事件，运行时无法分配任务`,
          nodeId: n.NodeID,
        })
      }
      if (hasRole && !hasStartEvent) {
        issues.push({
          level: 'warning',
          message: `任务节点[${label}]配置了角色但没有节点开始事件，引擎无法把角色解析成具体用户`,
          nodeId: n.NodeID,
        })
      }
    }

    if (n.NodeType === NodeType.Gateway) {
      const out = outgoing.get(n.NodeID) || []
      const conditions = n.GWConfig?.Conditions || []
      const inevitable = n.GWConfig?.InevitableNodes || []
      if (!out.length) {
        issues.push({ level: 'error', message: `网关[${label}]没有出线`, nodeId: n.NodeID })
      }
      if (!conditions.length && !inevitable.length && out.length) {
        issues.push({
          level: 'error',
          message: `网关[${label}]既没有条件分支也没有必然执行分支`,
          nodeId: n.NodeID,
        })
      }
      conditions.forEach((c) => {
        if (!c.NodeID || !byId.has(c.NodeID)) {
          issues.push({
            level: 'error',
            message: `网关[${label}]的条件分支指向了不存在的节点`,
            nodeId: n.NodeID,
          })
        }
        if (!c.Expression?.trim()) {
          issues.push({
            level: 'warning',
            message: `网关[${label}]存在没有条件表达式的分支，引擎执行时该分支不会命中`,
            nodeId: n.NodeID,
          })
        }
      })
      inevitable.forEach((id) => {
        if (!byId.has(id)) {
          issues.push({
            level: 'error',
            message: `网关[${label}]的必然执行分支指向了不存在的节点[${id}]`,
            nodeId: n.NodeID,
          })
        }
      })
    }
  })

  // ---- 从开始节点可达性 ----
  const start = startNodes[0]
  if (start) {
    const visited = new Set<string>()
    const stack = [start.NodeID]
    while (stack.length) {
      const cur = stack.pop()!
      if (visited.has(cur)) continue
      visited.add(cur)
      ;(outgoing.get(cur) || []).forEach((next) => {
        if (!visited.has(next)) stack.push(next)
      })
    }
    nodes.forEach((n) => {
      if (!visited.has(n.NodeID)) {
        issues.push({
          level: 'error',
          message: `节点[${n.NodeName || n.NodeID}]从开始节点不可达`,
          nodeId: n.NodeID,
        })
      }
    })
  }

  // ---- 环路检测 ----
  const inDegree = new Map<string, number>()
  nodes.forEach((n) => inDegree.set(n.NodeID, 0))
  nodes.forEach((n) => {
    ;(outgoing.get(n.NodeID) || []).forEach((next) => {
      inDegree.set(next, (inDegree.get(next) || 0) + 1)
    })
  })
  const q = nodes.filter((n) => (inDegree.get(n.NodeID) || 0) === 0).map((n) => n.NodeID)
  let removed = 0
  while (q.length) {
    const cur = q.shift()!
    removed += 1
    ;(outgoing.get(cur) || []).forEach((next) => {
      inDegree.set(next, (inDegree.get(next) || 0) - 1)
      if ((inDegree.get(next) || 0) === 0) q.push(next)
    })
  }
  if (removed !== nodes.length) {
    issues.push({ level: 'error', message: '流程定义中存在环，引擎无法正常流转（自由驳回请在任务运行时使用）' })
  }

  return issues
}

/* -------------------------------------------------------------------------- */
/* 进度计算（只读视图）                                                        */
/* -------------------------------------------------------------------------- */

export interface ProgressResult {
  nodeStates: Map<string, ProgressState>
  edgeStates: Map<string, ProgressState>
  nodeUsers: Map<string, string>
}

/**
 * 依据流程实例的任务历史，计算每个节点的执行状态，用于流程图回显。
 */
export function computeProgress(
  process: WorkflowProcess,
  tasks: WorkflowTask[],
  instanceStatus: number,
  currentNodeId: string,
): ProgressResult {
  const nodeStates = new Map<string, ProgressState>()
  const edgeStates = new Map<string, ProgressState>()
  const nodeUsers = new Map<string, string>()

  // 默认全部为未开始
  ;(process.Nodes || []).forEach((n) => nodeStates.set(n.NodeID, 'pending'))

  const nodes = process.Nodes || []
  const byId = new Map(nodes.map((n) => [n.NodeID, n]))

  // 按节点归组，取每一批（BatchCode）中 TaskID 最大的一批作为“最新状态”
  const byNode = new Map<string, WorkflowTask[]>()
  tasks.forEach((t) => {
    if (!byNode.has(t.NodeID)) byNode.set(t.NodeID, [])
    byNode.get(t.NodeID)!.push(t)
  })

  const rejectedNodes = new Set<string>()
  byNode.forEach((list, nodeId) => {
    const sorted = [...list].sort((a, b) => a.TaskID - b.TaskID)
    const latestBatch = sorted[sorted.length - 1]?.BatchCode
    const batchTasks = sorted.filter((t) => t.BatchCode === latestBatch)
    const rejected = batchTasks.some((t) => t.Status === 2 && t.IsFinished === 1)
    const allFinished = batchTasks.every((t) => t.IsFinished === 1)

    let state: ProgressState
    if (rejected) {
      state = 'rejected'
      rejectedNodes.add(nodeId)
    } else if (allFinished) state = 'done'
    else state = 'current'
    nodeStates.set(nodeId, state)

    const users = uniq(batchTasks.map((t) => t.UserID).filter(Boolean))
    if (users.length) nodeUsers.set(nodeId, users.join('、'))
  })

  // 流程已结束：已走过且无驳回的节点均为完成
  if (instanceStatus === 1) {
    byNode.forEach((_list, nodeId) => {
      if (!rejectedNodes.has(nodeId)) nodeStates.set(nodeId, 'done')
    })
  }
  if (instanceStatus === 2) {
    nodeStates.forEach((state, nodeId) => {
      if (state === 'current') nodeStates.set(nodeId, 'pending')
    })
  }

  // 当前节点
  if (instanceStatus === 0 && currentNodeId && !byNode.has(currentNodeId)) {
    nodeStates.set(currentNodeId, 'current')
  }

  /* ------------------------------------------------------------------ *
   * 连通性推导
   *
   * 网关节点不会产生任务记录，所以「是否有任务」不足以判断某条连线是否
   * 被走过。这里从有任务记录的节点出发，沿网关做双向传播：
   *   - 正向：已到达节点的下游网关，一定被经过（如 开始 -> 条件网关）
   *   - 反向：已到达节点的上游网关，也一定被经过（如 条件网关 -> 主管）
   * 由于排他网关未命中的分支不会产生任务，对应节点不会被标记，
   * 因此「目标节点已到达 => 该入线被走过」在分支场景下依然准确。
   * ------------------------------------------------------------------ */
  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  nodes.forEach((n) => {
    outgoing.set(n.NodeID, [])
    incoming.set(n.NodeID, [])
  })
  nodes.forEach((n) => {
    ;(n.PrevNodeIDs || []).forEach((prev) => {
      if (!byId.has(prev)) return
      outgoing.get(prev)!.push(n.NodeID)
      incoming.get(n.NodeID)!.push(prev)
    })
  })

  const isGateway = (id: string) => byId.get(id)?.NodeType === NodeType.Gateway
  const reached = new Set<string>()
  nodeStates.forEach((state, id) => {
    if (state !== 'pending') reached.add(id)
  })

  let changed = true
  let guard = 0
  const maxIterations = nodes.length * nodes.length + 16
  while (changed && guard < maxIterations) {
    changed = false
    guard += 1
    reached.forEach((id) => {
      // 正向：下游网关必然经过
      ;(outgoing.get(id) || []).forEach((next) => {
        if (isGateway(next) && !reached.has(next)) {
          reached.add(next)
          changed = true
        }
      })
      // 反向：上游网关必然经过
      ;(incoming.get(id) || []).forEach((prev) => {
        if (isGateway(prev) && !reached.has(prev)) {
          reached.add(prev)
          changed = true
        }
      })
    })
  }

  /* ------------------------------------------------------------------ *
   * 网关 / 结束节点的进度
   *
   * 网关和结束节点都不产生任务记录，上面那套推导只用来算连线状态，
   * 节点状态如果不管，它们就会一直是"未开始"：流程都走完到 END 了，
   * 图上 END（以及沿途的网关）还是灰的，看起来像是没走到。
   * 所以这里把推导结果也回填到节点状态：
   *   - 正向：已完成节点的下游网关，一定被经过
   *   - 反向：已到达节点（已完成/进行中）的上游网关，也一定被经过
   *   - 流程整体已完成时，结束节点标记为已完成
   * ------------------------------------------------------------------ */
  const passed = new Set<string>()
  nodeStates.forEach((state, id) => {
    if (state === 'done') passed.add(id)
  })

  let passChanged = true
  let passGuard = 0
  while (passChanged && passGuard < maxIterations) {
    passChanged = false
    passGuard += 1
    passed.forEach((id) => {
      // 正向：已完成节点的下游网关必然经过（进行中节点的下游还没走）
      ;(outgoing.get(id) || []).forEach((next) => {
        if (isGateway(next) && !passed.has(next)) {
          passed.add(next)
          passChanged = true
        }
      })
    })
    reached.forEach((id) => {
      // 反向：已到达节点的上游网关必然经过
      ;(incoming.get(id) || []).forEach((prev) => {
        if (isGateway(prev) && !passed.has(prev)) {
          passed.add(prev)
          passChanged = true
        }
      })
    })
  }

  passed.forEach((id) => {
    if (isGateway(id) && nodeStates.get(id) === 'pending') nodeStates.set(id, 'done')
  })

  if (instanceStatus === 1) {
    nodes.forEach((n) => {
      if (n.NodeType === NodeType.End) nodeStates.set(n.NodeID, 'done')
    })
  }

  // 连线状态：目标节点被驳回 => 该入线为驳回；目标节点已到达 => 已走过
  nodes.forEach((n) => {
    ;(n.PrevNodeIDs || []).forEach((prev) => {
      if (!byId.has(prev)) return
      const key = edgeKey(prev, n.NodeID)
      if (rejectedNodes.has(n.NodeID)) {
        edgeStates.set(key, 'rejected')
      } else if (reached.has(n.NodeID)) {
        edgeStates.set(key, 'done')
      }
    })
  })

  return { nodeStates, edgeStates, nodeUsers }
}

export { NODE_SIZE }
