import LogicFlow, {
  CircleNode,
  CircleNodeModel,
  DiamondNode,
  DiamondNodeModel,
  RectNode,
  RectNodeModel,
  type BaseNodeModel,
} from '@logicflow/core'
import { LF_NODE_TYPE, NODE_COLORS, PROGRESS_COLORS, type WfNodeProperties } from './constants'

/* -------------------------------------------------------------------------- */
/* 连线的公共规则                                                              */
/* -------------------------------------------------------------------------- */

/**
 * 关于 getDefaultAnchor 的坐标系（踩坑记录）：
 *
 * LogicFlow 2.2.5 的 `BaseNodeModel.getAnchorsByOffset()` 只有在 `anchorsOffset`
 * 非空时才会做「node.x/y + 偏移量」的换算，而 `anchorsOffset` 在 core 里从未被赋值，
 * 因此它总是直接返回 `getDefaultAnchor()` 的结果 —— 也就是说
 * `getDefaultAnchor()` 必须返回**画布绝对坐标**（自己加上 this.x / this.y）。
 *
 * 内置节点也是这么实现的（RectNodeModel 返回 x ± width/2，DiamondNodeModel 返回
 * this.points），如果这里只返回相对节点中心的偏移量，所有连线的起点/终点都会
 * 被算到画布原点附近：连线退化成一个点（看不见），连线文案则堆在画布左上角。
 */

type RuleOptions = {
  /** 是否允许作为连线起点 */
  allowOutgoing: boolean
  /** 是否允许作为连线终点 */
  allowIncoming: boolean
}

/**
 * 为节点模型挂上连线校验规则：
 *  1. 不允许自环
 *  2. 开始节点不能作为终点；结束节点不能作为起点
 */
function applyConnectRules(model: BaseNodeModel, options: RuleOptions) {
  if (!options.allowOutgoing) {
    model.sourceRules.push({
      message: '结束节点不能作为连线的起点',
      validate: () => false,
    })
  } else {
    model.sourceRules.push({
      message: '不允许节点连接到自身',
      validate: (source?: BaseNodeModel, target?: BaseNodeModel) => {
        if (!source || !target) return true
        return source.id !== target.id
      },
    })
  }

  if (!options.allowIncoming) {
    model.targetRules.push({
      message: '开始节点不能作为连线的终点',
      validate: () => false,
    })
  } else {
    model.targetRules.push({
      message: '不允许节点连接到自身',
      validate: (source?: BaseNodeModel, target?: BaseNodeModel) => {
        if (!source || !target) return true
        return source.id !== target.id
      },
    })
  }
}

/** 读取节点业务属性 */
function readProps(model: BaseNodeModel): WfNodeProperties {
  return (model.properties || {}) as WfNodeProperties
}

/** 根据进度状态计算节点样式覆盖 */
function progressOverride(model: BaseNodeModel): Record<string, unknown> | null {
  const state = readProps(model).progressState
  if (!state) return null
  const c = PROGRESS_COLORS[state]
  return { fill: c.fill, stroke: c.stroke, strokeWidth: c.strokeWidth }
}

/* -------------------------------------------------------------------------- */
/* 开始节点：圆形，只有右侧锚点                                                */
/* -------------------------------------------------------------------------- */

class WfStartModel extends CircleNodeModel {
  initNodeData(data: LogicFlow.NodeConfig) {
    super.initNodeData(data)
    this.r = 34
    this.text.editable = false
    applyConnectRules(this, { allowOutgoing: true, allowIncoming: false })
    const props = this.properties as WfNodeProperties
    props.nodeId = props.nodeId || this.id
    props.userIds = props.userIds || []
    props.roles = props.roles || []
    props.nodeStartEvents = props.nodeStartEvents || []
    props.nodeEndEvents = props.nodeEndEvents || []
    props.taskFinishEvents = props.taskFinishEvents || []
  }

  getDefaultAnchor(): { x: number; y: number; id: string }[] {
    const { x, y, r } = this
    return [{ x: x + r, y, id: `${this.id}_right` }]
  }

  getNodeStyle() {
    const style = super.getNodeStyle()
    const colors = NODE_COLORS[LF_NODE_TYPE.start]
    const merged = { ...style, fill: colors.fill, stroke: colors.stroke, strokeWidth: 2 }
    const override = progressOverride(this)
    return override ? { ...merged, ...override } : merged
  }

  getTextStyle() {
    const style = super.getTextStyle()
    return { ...style, fontSize: 12, fill: NODE_COLORS[LF_NODE_TYPE.start].text }
  }
}

/* -------------------------------------------------------------------------- */
/* 结束节点：圆形，只有左侧锚点                                                */
/* -------------------------------------------------------------------------- */

class WfEndModel extends CircleNodeModel {
  initNodeData(data: LogicFlow.NodeConfig) {
    super.initNodeData(data)
    this.r = 34
    this.text.editable = false
    applyConnectRules(this, { allowOutgoing: false, allowIncoming: true })
    const props = this.properties as WfNodeProperties
    props.nodeId = props.nodeId || this.id
    props.userIds = []
    props.roles = []
    props.nodeStartEvents = props.nodeStartEvents || []
    props.nodeEndEvents = []
    props.taskFinishEvents = []
  }

  getDefaultAnchor(): { x: number; y: number; id: string }[] {
    const { x, y, r } = this
    return [{ x: x - r, y, id: `${this.id}_left` }]
  }

  getNodeStyle() {
    const style = super.getNodeStyle()
    const colors = NODE_COLORS[LF_NODE_TYPE.end]
    const merged = { ...style, fill: colors.fill, stroke: colors.stroke, strokeWidth: 2 }
    const override = progressOverride(this)
    return override ? { ...merged, ...override } : merged
  }

  getTextStyle() {
    const style = super.getTextStyle()
    return { ...style, fontSize: 12, fill: NODE_COLORS[LF_NODE_TYPE.end].text }
  }
}

/* -------------------------------------------------------------------------- */
/* 任务节点：圆角矩形，左右锚点                                                */
/* -------------------------------------------------------------------------- */

class WfTaskModel extends RectNodeModel {
  initNodeData(data: LogicFlow.NodeConfig) {
    super.initNodeData(data)
    this.width = 172
    this.height = 56
    this.radius = 8
    applyConnectRules(this, { allowOutgoing: true, allowIncoming: true })
    const props = this.properties as WfNodeProperties
    props.nodeId = props.nodeId || this.id
    props.nodeName = props.nodeName || (this.text?.value ?? '') || this.id
    props.userIds = props.userIds || []
    props.roles = props.roles || []
    props.isCosigned = props.isCosigned ?? 0
    props.nodeStartEvents = props.nodeStartEvents || []
    props.nodeEndEvents = props.nodeEndEvents || []
    props.taskFinishEvents = props.taskFinishEvents || []
  }

  getDefaultAnchor(): { x: number; y: number; id: string }[] {
    const { x, y, width, height } = this
    return [
      { x: x - width / 2, y, id: `${this.id}_left` },
      { x: x + width / 2, y, id: `${this.id}_right` },
      { x, y: y - height / 2, id: `${this.id}_top` },
      { x, y: y + height / 2, id: `${this.id}_bottom` },
    ]
  }

  getNodeStyle() {
    const style = super.getNodeStyle()
    const colors = NODE_COLORS[LF_NODE_TYPE.task]
    const merged = { ...style, fill: colors.fill, stroke: colors.stroke, strokeWidth: 1.5, radius: 8 }
    const override = progressOverride(this)
    return override ? { ...merged, ...override } : merged
  }

  getTextStyle() {
    const style = super.getTextStyle()
    return { ...style, fontSize: 13, fill: NODE_COLORS[LF_NODE_TYPE.task].text }
  }
}

/* -------------------------------------------------------------------------- */
/* 网关节点：菱形，左右锚点                                                    */
/* -------------------------------------------------------------------------- */

class WfGatewayModel extends DiamondNodeModel {
  initNodeData(data: LogicFlow.NodeConfig) {
    super.initNodeData(data)
    this.rx = 74
    this.ry = 46
    this.text.editable = false
    applyConnectRules(this, { allowOutgoing: true, allowIncoming: true })
    const props = this.properties as WfNodeProperties
    props.nodeId = props.nodeId || this.id
    props.nodeName = props.nodeName || (this.text?.value ?? '') || this.id
    props.userIds = []
    props.roles = []
    props.isCosigned = 0
    props.gwMode = props.gwMode || 'exclusive'
    props.waitForAllPrevNode = props.waitForAllPrevNode ?? 0
    props.nodeStartEvents = props.nodeStartEvents || []
    props.nodeEndEvents = props.nodeEndEvents || []
    props.taskFinishEvents = props.taskFinishEvents || []
  }

  getDefaultAnchor(): { x: number; y: number; id: string }[] {
    const { x, y, rx, ry } = this
    return [
      { x: x - rx, y, id: `${this.id}_left` },
      { x: x + rx, y, id: `${this.id}_right` },
      { x, y: y - ry, id: `${this.id}_top` },
      { x, y: y + ry, id: `${this.id}_bottom` },
    ]
  }

  getNodeStyle() {
    const style = super.getNodeStyle()
    const colors = NODE_COLORS[LF_NODE_TYPE.gateway]
    const merged = { ...style, fill: colors.fill, stroke: colors.stroke, strokeWidth: 1.5 }
    const override = progressOverride(this)
    return override ? { ...merged, ...override } : merged
  }

  getTextStyle() {
    const style = super.getTextStyle()
    return { ...style, fontSize: 12, fill: NODE_COLORS[LF_NODE_TYPE.gateway].text }
  }
}

/* -------------------------------------------------------------------------- */
/* UI 样式                                                                     */
/* -------------------------------------------------------------------------- */

/** 应用统一主题（节点文字、连线样式等） */
export function applyWorkflowTheme(lf: LogicFlow) {
  lf.setTheme({
    rect: {
      radius: 8,
      stroke: NODE_COLORS[LF_NODE_TYPE.task].stroke,
      fill: NODE_COLORS[LF_NODE_TYPE.task].fill,
    },
    circle: {
      stroke: NODE_COLORS[LF_NODE_TYPE.start].stroke,
      fill: NODE_COLORS[LF_NODE_TYPE.start].fill,
    },
    diamond: {
      stroke: NODE_COLORS[LF_NODE_TYPE.gateway].stroke,
      fill: NODE_COLORS[LF_NODE_TYPE.gateway].fill,
    },
    nodeText: {
      color: '#1f2937',
      fontSize: 13,
      overflowMode: 'autoWrap',
      textWidth: 130,
    },
    edgeText: {
      background: {
        fill: '#ffffffee',
      },
      color: '#4b5563',
      fontSize: 11,
      textWidth: 100,
    },
    polyline: {
      stroke: '#94a3b8',
      strokeWidth: 1.5,
    },
    arrow: {
      offset: 8,
      verticalLength: 5,
    },
    anchor: {
      stroke: '#2b6cb0',
      fill: '#ffffff',
      r: 4,
    },
  })
}

/** 一次性注册全部工作流节点类型 */
export function registerWorkflowNodes(lf: LogicFlow) {
  lf.register({
    type: LF_NODE_TYPE.start,
    view: CircleNode,
    model: WfStartModel,
  })
  lf.register({
    type: LF_NODE_TYPE.task,
    view: RectNode,
    model: WfTaskModel,
  })
  lf.register({
    type: LF_NODE_TYPE.gateway,
    view: DiamondNode,
    model: WfGatewayModel,
  })
  lf.register({
    type: LF_NODE_TYPE.end,
    view: CircleNode,
    model: WfEndModel,
  })
}
