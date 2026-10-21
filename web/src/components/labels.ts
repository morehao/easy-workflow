import { NodeType, type NodeTypeValue } from '@/types/workflow'
import type { ProgressState } from '@/logicflow/constants'

/** 引擎节点类型文案 */
export const NODE_TYPE_TEXT: Record<NodeTypeValue, string> = {
  [NodeType.Root]: '开始节点',
  [NodeType.Task]: '任务节点',
  [NodeType.Gateway]: '网关节点',
  [NodeType.End]: '结束节点',
}

/** 引擎节点类型对应的 Tag 颜色 */
export const NODE_TYPE_COLOR: Record<NodeTypeValue, string> = {
  [NodeType.Root]: 'green',
  [NodeType.Task]: 'blue',
  [NodeType.Gateway]: 'orange',
  [NodeType.End]: 'red',
}

/** 流程实例状态 */
export const INSTANCE_STATUS_META: Record<number, { text: string; color: string }> = {
  0: { text: '审批中', color: 'processing' },
  1: { text: '已完成', color: 'success' },
  2: { text: '已撤销', color: 'default' },
  3: { text: '已挂起', color: 'warning' },
}

/** 任务状态 */
export const TASK_STATUS_META: Record<number, { text: string; color: string }> = {
  0: { text: '待处理', color: 'processing' },
  1: { text: '已通过', color: 'success' },
  2: { text: '已驳回', color: 'error' },
}

/**
 * 任务展示结果（status + is_finished 组合语义）。
 *
 * 引擎有个约定：非会签节点只要同批次里有人通过/驳回，其余任务会直接被置为
 * `is_finished=1`，但 `status` 保持 0（见 engine/ProcessTask.go `taskSubmit`）。
 * 这类任务是「系统结束、本人未处理」，不是待办；只看 status 会显示成"待处理"。
 * 后端已完成任务列表 SQL 也是用 `status!=0` 把这类任务过滤掉的（ProcessTask.go:423）。
 */
export function taskResultMeta(task: { Status: number; IsFinished: number }): { text: string; color: string } {
  if (!task.IsFinished) return TASK_STATUS_META[0]
  if (!task.Status) return { text: '系统结束', color: 'default' }
  return TASK_STATUS_META[task.Status] || { text: String(task.Status), color: 'default' }
}

/** 流程图中节点/连线的进度状态文案与颜色 */
export const PROGRESS_META: Record<ProgressState, { text: string; color: string }> = {
  pending: { text: '未开始', color: '#d9d9d9' },
  done: { text: '已完成', color: '#52c41a' },
  current: { text: '进行中', color: '#1677ff' },
  rejected: { text: '已驳回', color: '#ff4d4f' },
}
