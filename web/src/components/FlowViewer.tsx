import { useMemo } from 'react'
import type LogicFlow from '@logicflow/core'
import FlowCanvas from './FlowCanvas'
import { processToGraph } from '@/logicflow/convert'
import type { ProgressState } from '@/logicflow/constants'
import type { WorkflowProcess } from '@/types/workflow'
import { PROGRESS_META } from './labels'
import { fitReadableView } from '@/logicflow/viewport'

export interface FlowViewerProps {
  process: WorkflowProcess
  /** 节点进度状态：NodeID -> 状态 */
  nodeStates?: Map<string, ProgressState>
  /** 连线进度状态：`from->to` -> 状态 */
  edgeStates?: Map<string, ProgressState>
  /** 节点处理人汇总：NodeID -> 处理人 */
  nodeUsers?: Map<string, string>
  height?: number | string
  /** 点击节点回调 */
  onNodeClick?: (engineNodeId: string) => void
  /** 是否显示图例 */
  showLegend?: boolean
}

/** 把一个 Map 转成可比较的字符串签名，避免无意义的重渲染 */
function mapSignature(map?: Map<string, unknown>): string {
  if (!map) return ''
  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort()
    .join('|')
}

/**
 * 只读流程图。
 * 内部以签名作为 key，数据变化时重建 LogicFlow 实例并重新渲染，保证状态与画布一致。
 */
export default function FlowViewer({
  process,
  nodeStates,
  edgeStates,
  nodeUsers,
  height = 460,
  onNodeClick,
  showLegend = true,
}: FlowViewerProps) {
  const signature = useMemo(
    () =>
      [
        process.ProcessName,
        process.Nodes?.length ?? 0,
        (process.Nodes || []).map((n) => `${n.NodeID}:${n.NodeName}:${n.NodeType}`).join(','),
        mapSignature(nodeStates),
        mapSignature(edgeStates),
        mapSignature(nodeUsers),
      ].join('||'),
    [process, nodeStates, edgeStates, nodeUsers],
  )

  const graph = useMemo(
    () => processToGraph(process, { nodeStates, edgeStates, nodeUsers }),
    [signature], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const handleReady = (lf: LogicFlow) => {
    lf.render(graph)
    window.setTimeout(() => fitReadableView(lf), 0)
  }

  /** LogicFlow 节点 id -> 引擎 NodeID */
  const engineIdOfLfId = useMemo(() => {
    const map = new Map<string, string>()
    ;(graph.nodes || []).forEach((n) => {
      if (!n.id) return
      const props = n.properties as { nodeId?: string } | undefined
      map.set(n.id, props?.nodeId || n.id)
    })
    return map
  }, [graph])

  return (
    <div>
      {showLegend && (
        <div className="flow-legend" style={{ marginBottom: 8 }}>
          {(Object.keys(PROGRESS_META) as ProgressState[]).map((state) => (
            <span className="flow-legend-item" key={state}>
              <span
                className="flow-legend-dot"
                style={{
                  background: state === 'pending' ? '#fff' : PROGRESS_META[state].color,
                  borderColor: PROGRESS_META[state].color,
                }}
              />
              {PROGRESS_META[state].text}
            </span>
          ))}
          <span className="flow-legend-item text-muted">点击节点可查看该节点的处理记录</span>
        </div>
      )}

      <div className="lf-canvas-wrapper" style={{ height }}>
        <FlowCanvas
          key={signature}
          editable={false}
          style={{ height: '100%' }}
          onReady={handleReady}
          onSelect={(sel) => {
            if (!sel || sel.kind !== 'node') return
            const engineNodeId = engineIdOfLfId.get(sel.id)
            if (engineNodeId) onNodeClick?.(engineNodeId)
          }}
        />
      </div>
    </div>
  )
}
