import { http, toForm, toQuery } from './client'
import type { ProcInstance, WorkflowTask } from '@/types/workflow'

export interface StartInstanceParams {
  ProcessID: number
  BusinessID: string
  Comment?: string
  /** 注意后端字段名是 VariablesJson */
  Variables?: { Key: string; Value: string }[]
}

/** POST /inst/start 发起流程，返回流程实例ID */
export function startInstance(params: StartInstanceParams): Promise<number> {
  return http.post(
    '/inst/start',
    toForm({
      ProcessID: params.ProcessID,
      BusinessID: params.BusinessID,
      Comment: params.Comment,
      VariablesJson: params.Variables?.length ? JSON.stringify(params.Variables) : undefined,
    }),
  )
}

/** POST /inst/revoke 撤销流程实例 */
export function revokeInstance(instanceID: number, revokeUserID: string, force: boolean): Promise<string> {
  return http.post(
    '/inst/revoke',
    toForm({ InstanceID: instanceID, RevokeUserID: revokeUserID, Force: force }),
  )
}

/** GET /inst/task_history 流程实例的任务执行记录 */
export function getInstanceTaskHistory(instanceID: number): Promise<WorkflowTask[]> {
  return http.get('/inst/task_history', { params: toQuery({ instid: instanceID }) })
}

export interface StartByUserParams {
  userid?: string
  procname?: string
  idx?: number
  rows?: number
}

/** GET /inst/start/by 我发起的流程实例 */
export function listInstanceStartByUser(params: StartByUserParams): Promise<ProcInstance[]> {
  return http.get('/inst/start/by', {
    params: toQuery({
      userid: params.userid,
      procname: params.procname,
      // 后端用 strconv.Atoi 解析，必须传数字，空值会被过滤掉
      idx: params.idx ?? 0,
      rows: params.rows ?? 100,
    }),
  })
}
