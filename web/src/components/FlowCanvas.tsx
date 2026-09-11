import LogicFlow from '@logicflow/core'
import { Menu, SelectionSelect, Snapshot } from '@logicflow/extension'
import '@logicflow/core/es/index.css'
import '@logicflow/extension/es/index.css'
import { useEffect, useRef, type CSSProperties } from 'react'
import { applyWorkflowTheme, registerWorkflowNodes } from '@/logicflow/nodes'
import { LF_NODE_TYPE } from '@/logicflow/constants'

// 插件为全局注册，只需执行一次
LogicFlow.use(Menu)
LogicFlow.use(SelectionSelect)
LogicFlow.use(Snapshot)

export interface FlowCanvasProps {
  /** true: 可编辑（设计器）；false: 只读（流程图回显） */
  editable?: boolean
  className?: string
  style?: CSSProperties
  /** 实例创建完成回调，父组件拿到 lf 后可自行 render / 增删改 */
  onReady?: (lf: LogicFlow) => void
  /** 选中的元素（点击节点或连线） */
  onSelect?: (selection: { id: string; kind: 'node' | 'edge' } | null) => void
  /** 图数据发生变化（增删节点/连线、撤销重做等） */
  onGraphChange?: () => void
  /** 右键菜单删除回调，交给父组件处理业务（如自动布局/校验刷新） */
  onDelete?: (selection: { id: string; kind: 'node' | 'edge' }) => void
}

/**
 * LogicFlow 画布的通用封装。
 *
 * 生命周期：组件挂载时创建实例并把实例交给父组件（onReady），卸载时销毁。
 * 需要重新加载图数据时，请父组件调用 `lf.render(graph)`；需要强制重建实例时改变组件的 key。
 */
export default function FlowCanvas({
  editable = true,
  className,
  style,
  onReady,
  onSelect,
  onGraphChange,
  onDelete,
}: FlowCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lfRef = useRef<LogicFlow | null>(null)

  // 用 ref 保存回调，避免因父组件重新渲染导致 LogicFlow 实例被反复重建
  const callbacks = useRef({ onReady, onSelect, onGraphChange, onDelete })
  callbacks.current = { onReady, onSelect, onGraphChange, onDelete }

  useEffect(() => {
    if (!containerRef.current) return

    const lf = new LogicFlow({
      container: containerRef.current,
      grid: {
        size: 12,
        visible: true,
        type: 'dot',
        config: { color: '#dbe0e6', thickness: 1 },
      },
      background: { color: '#fafafa' },
      // 只读模式下关闭所有编辑能力，但保持点击事件可用，便于查看节点详情
      isSilentMode: false,
      adjustEdge: editable,
      adjustEdgeStartAndEnd: editable,
      adjustNodePosition: editable,
      allowRotate: false,
      allowResize: false,
      textEdit: editable,
      nodeTextEdit: editable,
      edgeTextEdit: false,
      hideAnchors: !editable,
      nodeSelectedOutline: true,
      edgeSelectedOutline: true,
      hoverOutline: editable,
      stopMoveGraph: false,
      stopScrollGraph: false,
      stopZoomGraph: false,
      autoExpand: false,
      snapline: editable,
      history: editable,
      edgeType: 'polyline',
      multipleSelectKey: 'shift',
    })

    registerWorkflowNodes(lf)
    applyWorkflowTheme(lf)

    // ---- 右键菜单 ----
    const menu = lf.extension.menu as InstanceType<typeof Menu> | undefined
    if (editable) {
      menu?.setMenuConfig({
        nodeMenu: [
          {
            text: '删除节点',
            className: 'wf-menu-delete',
            callback: (node) => {
              lf.deleteNode(node.id)
              callbacks.current.onDelete?.({ id: node.id, kind: 'node' })
              callbacks.current.onSelect?.(null)
            },
          },
        ],
        edgeMenu: [
          {
            text: '删除连线',
            className: 'wf-menu-delete',
            callback: (edge) => {
              lf.deleteEdge(edge.id)
              callbacks.current.onDelete?.({ id: edge.id, kind: 'edge' })
              callbacks.current.onSelect?.(null)
            },
          },
        ],
        graphMenu: [],
      })
    } else {
      menu?.setMenuConfig({ nodeMenu: false, edgeMenu: false, graphMenu: false })
    }

    // ---- 选中事件 ----
    lf.on('node:click', ({ data }) => {
      callbacks.current.onSelect?.({ id: data.id, kind: 'node' })
    })
    lf.on('edge:click', ({ data }) => {
      callbacks.current.onSelect?.({ id: data.id, kind: 'edge' })
    })
    lf.on('blank:click', () => {
      callbacks.current.onSelect?.(null)
    })

    // ---- 图数据变化 ----
    lf.on('history:change', () => callbacks.current.onGraphChange?.())
    if (editable) {
      lf.on('node:add', () => callbacks.current.onGraphChange?.())
      lf.on('node:delete', () => callbacks.current.onGraphChange?.())
      lf.on('edge:add', () => callbacks.current.onGraphChange?.())
      lf.on('edge:delete', () => callbacks.current.onGraphChange?.())
      lf.on('connection:not-allowed', ({ msg }) => {
        // 使用 antd 的 message 会造成循环依赖，这里退化为控制台提示 + 画布节点自带的不允许状态样式
        // eslint-disable-next-line no-console
        console.warn('[LogicFlow] 连线被拒绝:', msg)
      })
    }

    lfRef.current = lf
    callbacks.current.onReady?.(lf)

    // LogicFlow 在实例化时若容器尚未完成布局，会取到 0 宽高并告警。
    // 用 ResizeObserver 在容器尺寸确定/变化时重新测量，同时也能响应窗口缩放、侧边栏折叠等场景。
    const container = containerRef.current
    let observer: ResizeObserver | undefined
    if (container && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (container.offsetParent === null) return
        if (!container.clientWidth || !container.clientHeight) return
        lf.resize()
      })
      observer.observe(container)
    }

    return () => {
      observer?.disconnect()
      lf.destroy()
      lfRef.current = null
    }
    // 仅依赖 editable：父组件用 key 控制实例重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable])

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <div ref={containerRef} className="lf-canvas" style={{ height: '100%', width: '100%' }} />
    </div>
  )
}

/** 供设计器初始化新节点时使用的默认属性 */
export function defaultNodeProperties(type: string, nodeId: string, label: string) {
  if (type === LF_NODE_TYPE.start) {
    return {
      nodeId,
      nodeName: label,
      userIds: ['$starter'],
      roles: [],
      isCosigned: 0,
      nodeStartEvents: [],
      nodeEndEvents: [],
      taskFinishEvents: [],
    }
  }
  if (type === LF_NODE_TYPE.gateway) {
    return {
      nodeId,
      nodeName: label,
      userIds: [],
      roles: [],
      isCosigned: 0,
      gwMode: 'exclusive' as const,
      waitForAllPrevNode: 0,
      nodeStartEvents: [],
      nodeEndEvents: [],
      taskFinishEvents: [],
    }
  }
  if (type === LF_NODE_TYPE.end) {
    return {
      nodeId,
      nodeName: label,
      userIds: [],
      roles: [],
      isCosigned: 0,
      nodeStartEvents: [],
      nodeEndEvents: [],
      taskFinishEvents: [],
    }
  }
  return {
    nodeId,
    nodeName: label,
    userIds: [],
    roles: [],
    isCosigned: 0,
    nodeStartEvents: [],
    nodeEndEvents: [],
    taskFinishEvents: [],
  }
}
