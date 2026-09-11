import type LogicFlow from '@logicflow/core'

/** fitView 之后允许的最小缩放：低于这个值节点文字就不可读了 */
export const MIN_READABLE_SCALE = 0.75

/** 视口左侧 / 上下的留白（画布坐标） */
const PADDING = 28

/**
 * 先自适应整图，再保证缩放不低于可读下限。
 *
 * 背景：`fitView()` 会把整张图缩到一屏。但流程链一长
 * （开始 -> 条件网关 -> 主管审批 -> 并行网关 -> 人事/副总 -> 汇聚网关 -> 老板 -> 结束），
 * 图形是一个很扁的横条，fitView 会缩到 0.3~0.4 倍，节点文字完全看不清。
 * 这里宁可让用户拖拽/滚动看完整张图，也保证文字可读。
 *
 * 放大之后视口会落在图形中间，因此再把视口定位到流程起点所在的左侧，
 * 符合从左到右的阅读顺序；若整图本来就比视口窄，则保持居中。
 */
export function fitReadableView(lf: LogicFlow) {
  lf.fitView(56, 56)

  const transform = lf.graphModel.transformModel
  if (transform.SCALE_X >= MIN_READABLE_SCALE) return

  lf.zoom(MIN_READABLE_SCALE)

  const nodes = lf.graphModel.nodes
  if (!nodes.length) return

  const xs = nodes.map((n) => n.x)
  const ys = nodes.map((n) => n.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const scale = lf.graphModel.transformModel.SCALE_X
  const viewportWidth = lf.graphModel.width
  const viewportHeight = lf.graphModel.height
  if (!scale || !viewportWidth || !viewportHeight) return

  // 视口换成画布坐标后的一半宽度
  const halfViewportWidth = viewportWidth / 2 / scale
  // 让「最左侧节点再往左一点」正好落在视口左边缘
  const leftAlignedX = minX - PADDING + halfViewportWidth
  // 整图比视口窄时不强行左对齐，避免右侧留出大片空白
  const targetX = Math.min(leftAlignedX, (minX + maxX) / 2)

  lf.graphModel.transformModel.focusOn(targetX, (minY + maxY) / 2, viewportWidth, viewportHeight)
}
