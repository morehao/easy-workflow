import { http, toForm, toQuery } from './client'
import type { TaskAction, WorkflowNode, WorkflowTask } from '@/types/workflow'

/**
 * 注意：后端 /task/* 接口读取的表单字段名是 `VariableJson`（单数），
 * 而 /inst/start 读取的是 `VariablesJson`（复数）。这里必须严格区分，否则变量会被静默丢弃。
 * 见 workflow/web_api/service/service.go。
 */
function variableJson(variables?: { Key: string; Value: string }[]): string | undefined {
  return variables?.length ? JSON.stringify(variables) : undefined
}

/** POST /task/pass 任务通过 */
export function taskPass(
  taskID: number,
  comment?: string,
  variables?: { Key: string; Value: string }[],
): Promise<string> {
  return http.post('/task/pass', toForm({ TaskID: taskID, Comment: comment, VariableJson: variableJson(variables) }))
}

/** POST /task/pass/directly 通过后直接回到上一个驳回我的节点（仅非会签节点可用） */
export function taskPassDirectly(
  taskID: number,
  comment?: string,
  variables?: { Key: string; Value: string }[],
): Promise<string> {
  return http.post(
    '/task/pass/directly',
    toForm({ TaskID: taskID, Comment: comment, VariableJson: variableJson(variables) }),
  )
}

/** POST /task/reject 任务驳回（回到上一节点） */
export function taskReject(
  taskID: number,
  comment?: string,
  variables?: { Key: string; Value: string }[],
): Promise<string> {
  return http.post('/task/reject', toForm({ TaskID: taskID, Comment: comment, VariableJson: variableJson(variables) }))
}

/** POST /task/reject/free 自由驳回：驳回到上游任意节点 */
export function taskFreeReject(
  taskID: number,
  rejectToNodeID: string,
  comment?: string,
  variables?: { Key: string; Value: string }[],
): Promise<string> {
  return http.post(
    '/task/reject/free',
    toForm({
      TaskID: taskID,
      RejectToNodeID: rejectToNodeID,
      Comment: comment,
      VariableJson: variableJson(variables),
    }),
  )
}

/** POST /task/add-sign 加签：当前节点追加一个会签处理人 */
export function addSignTask(taskID: number, userID: string, comment?: string): Promise<{ TaskID: number; UserID: string }> {
  return http.post('/task/add-sign', toForm({ TaskID: taskID, UserID: userID, Comment: comment }))
}

/** POST /task/batch-pass 批量通过 */
export function batchPassTasks(
  taskIDs: number[],
  comment?: string,
  variables?: { Key: string; Value: string }[],
): Promise<{ passed: number[]; failed: { TaskID: number; Error: string }[] }> {
  return http.post(
    '/task/batch-pass',
    toForm({ TaskIDs: taskIDs.join(','), Comment: comment, VariableJson: variableJson(variables) }),
  )
}

/** POST /task/transfer 转办 */
export function taskTransfer(taskID: number, users: string[]): Promise<string> {
  return http.post('/task/transfer', toForm({ TaskID: taskID, Users: users.join(',') }))
}

export interface TaskQueryParams {
  userid?: string
  procname?: string
  asc?: boolean
  idx?: number
  rows?: number
}

/** GET /task/todo 待办任务 */
export function listTodoTasks(params: TaskQueryParams): Promise<WorkflowTask[]> {
  return http.get('/task/todo', {
    params: toQuery({
      userid: params.userid,
      procname: params.procname,
      asc: params.asc ?? true,
      idx: params.idx ?? 0,
      rows: params.rows ?? 100,
    }),
  })
}

export interface FinishedQueryParams extends TaskQueryParams {
  ignorestartbyme?: boolean
}

/** GET /task/finished 已办任务 */
export function listFinishedTasks(params: FinishedQueryParams): Promise<WorkflowTask[]> {
  return http.get('/task/finished', {
    params: toQuery({
      userid: params.userid,
      procname: params.procname,
      ignorestartbyme: params.ignorestartbyme ?? false,
      asc: params.asc ?? true,
      idx: params.idx ?? 0,
      rows: params.rows ?? 100,
    }),
  })
}

/** GET /task/upstream 当前任务所在节点的所有上游节点（自由驳回用） */
export function listUpstreamNodes(taskID: number): Promise<WorkflowNode[]> {
  return http.get('/task/upstream', { params: toQuery({ taskid: taskID }) })
}

/** GET /task/action 当前任务可执行的操作 */
export function getTaskAction(taskID: number): Promise<TaskAction> {
  return http.get('/task/action', { params: toQuery({ taskid: taskID }) })
}

/** GET /task/info 任务详情 */
export function getTaskInfo(taskID: number): Promise<WorkflowTask> {
  return http.get('/task/info', { params: toQuery({ taskid: taskID }) })
}
