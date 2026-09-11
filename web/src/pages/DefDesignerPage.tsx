import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { App as AntdApp, Alert, Button, Card, Divider, Popconfirm, Space, Spin, Tooltip, Typography } from 'antd'
import {
  ApartmentOutlined,
  ClearOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExperimentOutlined,
  GatewayOutlined,
  RedoOutlined,
  SaveOutlined,
  SyncOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import type LogicFlow from '@logicflow/core'
import { Snapshot } from '@logicflow/extension'
import FlowCanvas, { defaultNodeProperties } from '@/components/FlowCanvas'
import NodePropertyPanel from '@/components/designer/NodePropertyPanel'
import EdgePropertyPanel from '@/components/designer/EdgePropertyPanel'
import ProcessMetaPanel, { type ProcessMeta } from '@/components/designer/ProcessMetaPanel'
import ValidationList from '@/components/designer/ValidationList'
import { useCurrentUser } from '@/components/CurrentUserContext'
import { getProcDef, saveProcDef } from '@/api/def'
import {
  autoLayout,
  graphToProcess,
  nextNodeId,
  processToGraph,
  validateProcess,
  type ValidationIssue,
} from '@/logicflow/convert'
import { NODE_COLORS, PALETTE_ITEMS, LF_NODE_TYPE, type LfNodeType, type WfNodeProperties } from '@/logicflow/constants'
import { createExampleProcess } from '@/logicflow/example'
import { fitReadableView } from '@/logicflow/viewport'

const DRAG_MIME = 'application/x-workflow-node'
/** renderedRef 的空流程哨兵值（避免与流程ID 混淆） */
const NEW_PROCESS_KEY = '__new__'
/** renderedRef 的示例流程哨兵值 */
const DEMO_KEY = '__demo__'


interface Selection {
  id: string
  kind: 'node' | 'edge'
}

/** 左侧调色板 */
function Palette({
  onAdd,
  disabled,
}: {
  onAdd: (type: LfNodeType, label: string) => void
  disabled: boolean
}) {
  const shapeClass = (type: LfNodeType) => {
    if (type === LF_NODE_TYPE.gateway) return 'palette-item-shape palette-shape-diamond'
    if (type === LF_NODE_TYPE.task) return 'palette-item-shape palette-shape-rect'
    return 'palette-item-shape palette-shape-circle'
  }

  return (
    <Card size="small" title="节点面板" className="designer-palette" styles={{ body: { padding: 12 } }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        拖拽到画布，或点击直接添加
      </Typography.Text>
      <div style={{ marginTop: 10 }}>
        {PALETTE_ITEMS.map((item) => (
          <div
            key={item.type}
            className="palette-item"
            draggable={!disabled}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: item.type, text: item.text }))
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => !disabled && onAdd(item.type, item.text)}
          >
            <div
              className={shapeClass(item.type)}
              style={{ borderColor: item.color, background: NODE_COLORS[item.type].fill }}
            />
            <div>
              <div className="palette-item-title">{item.label}</div>
              <div className="palette-item-desc">{item.description}</div>
            </div>
          </div>
        ))}
      </div>

      <Divider style={{ margin: '12px 0' }} />

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        <strong>连线</strong>：从节点锚点拖出即可连接
        <br />
        <strong>开始节点</strong>只能连出，<strong>结束节点</strong>只能连入
      </Typography.Text>
    </Card>
  )
}

export default function DefDesignerPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  /** 访问 /defs/new?demo=1 可直接载入示例流程，便于快速体验与演示 */
  const demo = searchParams.get('demo') === '1'
  const isEdit = !!id
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const { userId } = useCurrentUser()

  const [lf, setLf] = useState<LogicFlow | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [tick, setTick] = useState(0)
  const [meta, setMeta] = useState<ProcessMeta>({ processName: '', source: '办公系统', revokeEvents: [] })
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const renderedRef = useRef<string | null>(null)

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  const handleReady = useCallback((instance: LogicFlow) => {
    setLf(instance)
    renderedRef.current = null
  }, [])

  /* ------------------------------ 载入已有流程定义 ------------------------------ */
  useEffect(() => {
    if (!lf) return
    if (!isEdit) {
      // LogicFlow 只有在 render 之后才会创建画布（网格、SVG 图层），
      // 新建流程也必须渲染一次空图，否则画布是空白的。
      const key = demo ? DEMO_KEY : NEW_PROCESS_KEY
      if (renderedRef.current === key) return
      renderedRef.current = key
      if (demo) {
        const process = createExampleProcess()
        setMeta({
          processName: process.ProcessName,
          source: process.Source,
          revokeEvents: process.RevokeEvents || [],
        })
        lf.render(processToGraph(process))
      } else {
        setMeta({ processName: '', source: '办公系统', revokeEvents: [] })
        lf.render({ nodes: [], edges: [] })
      }
      setSelection(null)
      setIssues([])
      window.setTimeout(() => fitReadableView(lf), 0)
      return
    }
    if (renderedRef.current === id) return
    renderedRef.current = id ?? null

    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const process = await getProcDef(Number(id))
        if (cancelled) return
        setMeta({
          processName: process.ProcessName,
          source: process.Source,
          revokeEvents: process.RevokeEvents || [],
        })
        lf.render(processToGraph(process))
        setSelection(null)
        setIssues([])
        window.setTimeout(() => fitReadableView(lf), 0)
      } catch (e) {
        if (!cancelled) message.error((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [lf, id, isEdit, demo, message])

  /* --------------------------------- 图数据 --------------------------------- */

  const buildProcess = useCallback(() => {
    if (!lf) return null
    return graphToProcess(lf.getGraphRawData(), meta)
  }, [lf, meta])

  const nodeIdsInGraph = useMemo(() => {
    if (!lf) return [] as string[]
    return (lf.getGraphRawData().nodes || []).map(
      (n) => ((n.properties || {}) as WfNodeProperties).nodeId || n.id,
    )
    // tick 用于在属性变更后重新计算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lf, tick])

  /* ---------------------------------- 交互 ---------------------------------- */

  const addNodeAt = useCallback(
    (type: LfNodeType, label: string, position?: { x: number; y: number }) => {
      if (!lf) return
      const nodeId = nextNodeId(type, nodeIdsInGraph)
      const pos = position ?? {
        x: 160 + (nodeIdsInGraph.length % 5) * 60,
        y: 120 + (nodeIdsInGraph.length % 5) * 60,
      }
      lf.addNode({
        type,
        x: pos.x,
        y: pos.y,
        text: label,
        properties: defaultNodeProperties(type, nodeId, label) as Record<string, unknown>,
      })
      refresh()
    },
    [lf, nodeIdsInGraph, refresh],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      if (!lf) return
      const raw = e.dataTransfer.getData(DRAG_MIME)
      if (!raw) return
      try {
        const { type, text } = JSON.parse(raw) as { type: LfNodeType; text: string }
        const { canvasOverlayPosition } = lf.getPointByClient(e.clientX, e.clientY)
        addNodeAt(type, text, canvasOverlayPosition)
      } catch {
        message.warning('无法识别的拖拽数据')
      }
    },
    [lf, addNodeAt, message],
  )

  const handleAutoLayout = useCallback(() => {
    if (!lf) return
    const graph = lf.getGraphRawData()
    const nodes = graph.nodes || []
    const edges = graph.edges || []
    if (!nodes.length) {
      message.info('画布上还没有节点')
      return
    }
    const positions = autoLayout(
      nodes.map((n) => n.id),
      edges.map((e) => ({ source: e.sourceNodeId, target: e.targetNodeId })),
      (nodeId) => {
        const model = lf.getNodeModelById(nodeId)
        return { width: model?.width ?? 172, height: model?.height ?? 56 }
      },
    )
    positions.forEach((pos, nodeId) => {
      lf.graphModel.moveNode2Coordinate(nodeId, pos.x, pos.y)
    })
    lf.fitView(60, 60)
    refresh()
  }, [lf, message, refresh])

  const handleValidate = useCallback(() => {
    const process = buildProcess()
    if (!process) return []
    const list = validateProcess(process)
    setIssues(list)
    if (!list.some((i) => i.level === 'error')) {
      message.success('校验通过')
    }
    return list
  }, [buildProcess, message])

  const handleSave = useCallback(async () => {
    const process = buildProcess()
    if (!process) return
    const list = validateProcess(process)
    setIssues(list)
    if (list.some((i) => i.level === 'error')) {
      message.error('校验未通过，请先修复右侧的错误')
      return
    }
    setSaving(true)
    try {
      const procId = await saveProcDef(JSON.stringify(process), userId || 'system')
      message.success(`保存成功，流程ID ${procId}（同名同来源会升版本）`)
      navigate(`/defs/${procId}`)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [buildProcess, message, navigate, userId])

  const handleLoadExample = useCallback(() => {
    if (!lf) return
    const process = createExampleProcess()
    lf.render(processToGraph(process))
    setMeta({
      processName: process.ProcessName,
      source: process.Source,
      revokeEvents: process.RevokeEvents || [],
    })
    setSelection(null)
    setIssues([])
    window.setTimeout(() => fitReadableView(lf), 0)
    message.success('已载入示例流程（员工请假），可直接保存并试跑')
  }, [lf, message])

  const handleClear = useCallback(() => {
    if (!lf) return
    lf.clearData()
    setSelection(null)
    setIssues([])
    refresh()
  }, [lf, refresh])

  const handleDeleteSelected = useCallback(() => {
    if (!lf || !selection) return
    if (selection.kind === 'node') lf.deleteNode(selection.id)
    else lf.deleteEdge(selection.id)
    setSelection(null)
    refresh()
  }, [lf, selection, refresh])

  const handleExportImage = useCallback(async () => {
    if (!lf) return
    const snapshot = lf.extension.snapshot as unknown as InstanceType<typeof Snapshot> | undefined
    if (!snapshot) {
      message.warning('快照插件未启用')
      return
    }
    await snapshot.getSnapshot(`流程定义_${meta.processName || '未命名'}`)
  }, [lf, message, meta.processName])

  const locateNode = useCallback(
    (engineNodeId: string) => {
      if (!lf) return
      const node = (lf.getGraphRawData().nodes || []).find(
        (n) => ((n.properties || {}) as WfNodeProperties).nodeId === engineNodeId,
      )
      if (node) {
        lf.focusOn(node.id)
        lf.selectElementById(node.id)
        setSelection({ id: node.id, kind: 'node' })
      }
    },
    [lf],
  )

  /* --------------------------------- 渲染 --------------------------------- */

  const currentNodeId = selection?.kind === 'node' ? selection.id : null
  const graphNodeIds = nodeIdsInGraph
  const duplicatedId = useMemo(() => {
    if (!currentNodeId) return false
    const current = (lf?.getNodeModelById(currentNodeId)?.getProperties() as WfNodeProperties)?.nodeId
    if (!current) return false
    return graphNodeIds.filter((x) => x === current).length > 1
    // tick 让重复检测随属性变更刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNodeId, graphNodeIds, lf, tick])

  const errorCount = issues.filter((i) => i.level === 'error').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100vh - 88px)' }}>
      {/* 顶部操作栏 */}
      <Card size="small" styles={{ body: { padding: '10px 12px' } }}>
        <Space wrap size={8} style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap size={8}>
            <ApartmentOutlined style={{ color: '#1677ff' }} />
            <Typography.Text strong>
              {isEdit ? `编辑流程定义 #${id}` : '新建流程定义'}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {meta.processName || '未命名'} / {meta.source || '未设置来源'}
            </Typography.Text>
            <Divider type="vertical" />
            <Tooltip title="撤销 (Ctrl+Z)">
              <Button size="small" icon={<UndoOutlined />} onClick={() => lf?.undo()} disabled={!lf} />
            </Tooltip>
            <Tooltip title="重做 (Ctrl+Shift+Z)">
              <Button size="small" icon={<RedoOutlined />} onClick={() => lf?.redo()} disabled={!lf} />
            </Tooltip>
            <Divider type="vertical" />
            <Tooltip title="放大">
              <Button size="small" icon={<ZoomInOutlined />} onClick={() => lf?.zoom(true)} disabled={!lf} />
            </Tooltip>
            <Tooltip title="缩小">
              <Button size="small" icon={<ZoomOutOutlined />} onClick={() => lf?.zoom(false)} disabled={!lf} />
            </Tooltip>
            <Tooltip title="适应画布">
              <Button size="small" icon={<SyncOutlined />} onClick={() => lf?.fitView(60, 60)} disabled={!lf} />
            </Tooltip>
            <Tooltip title="自动布局（按拓扑分层）">
              <Button size="small" icon={<GatewayOutlined />} onClick={handleAutoLayout} disabled={!lf}>
                自动布局
              </Button>
            </Tooltip>
            <Tooltip title="删除选中元素">
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={handleDeleteSelected}
                disabled={!selection}
              />
            </Tooltip>
            <Tooltip title="导出 PNG 图片">
              <Button size="small" icon={<DownloadOutlined />} onClick={handleExportImage} disabled={!lf} />
            </Tooltip>
          </Space>

          <Space wrap size={8}>
            <Button size="small" icon={<ExperimentOutlined />} onClick={handleLoadExample} disabled={!lf}>
              加载示例
            </Button>
            <Popconfirm title="确定清空画布？" onConfirm={handleClear} disabled={!lf}>
              <Button size="small" icon={<ClearOutlined />} disabled={!lf}>
                清空
              </Button>
            </Popconfirm>
            <Button size="small" icon={<CheckCircleOutlined />} onClick={handleValidate} disabled={!lf}>
              校验
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={handleSave}
              disabled={!lf}
            >
              保存流程
            </Button>
          </Space>
        </Space>
      </Card>

      {/* 校验提示 */}
      {errorCount > 0 && (
        <Alert
          type="error"
          showIcon
          message={`当前流程定义有 ${errorCount} 个错误，保存会被拦截，请在右下角「校验结果」中查看`}
        />
      )}

      {/* 主体三栏 */}
      <div className="designer-layout" style={{ flex: 1, minHeight: 0 }}>
        <Palette onAdd={(type, label) => addNodeAt(type, label)} disabled={!lf} />

        <div className="designer-canvas">
          <Spin spinning={loading}>
            <div
              className="lf-canvas-wrapper"
              style={{ height: 'calc(100vh - 260px)', minHeight: 420 }}
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
              }}
            >
              <FlowCanvas
                editable
                style={{ height: '100%' }}
                onReady={handleReady}
                onSelect={setSelection}
                onGraphChange={refresh}
                onDelete={() => setSelection(null)}
              />
            </div>
          </Spin>
        </div>

        <Card
          size="small"
          className="designer-props"
          title={selection ? (selection.kind === 'node' ? '节点属性' : '连线属性') : '流程属性'}
          styles={{ body: { padding: 12 } }}
        >
          {selection?.kind === 'node' && lf ? (
            <NodePropertyPanel
              lf={lf}
              nodeId={selection.id}
              onChange={refresh}
              duplicatedId={duplicatedId}
            />
          ) : selection?.kind === 'edge' && lf ? (
            <EdgePropertyPanel lf={lf} edgeId={selection.id} onChange={refresh} />
          ) : (
            <ProcessMetaPanel value={meta} onChange={setMeta} />
          )}

          <Divider style={{ margin: '12px 0' }} />
          <Typography.Text strong style={{ fontSize: 13 }}>
            校验结果
          </Typography.Text>
          <div style={{ marginTop: 8 }}>
            <ValidationList issues={issues} onLocate={locateNode} />
          </div>
        </Card>
      </div>
    </div>
  )
}
