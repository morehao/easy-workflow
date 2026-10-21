import { http, toForm, toQuery } from './client'
import type { ProcInstance, WorkflowTask } from '@/types/workflow'

export interface StartInstanceParams {
  ProcessID: number
  BusinessID: string
  Comment?: string
  /** 注意后端字段名是 VariablesJson */
  Variables?: { Key: string; Value: string }[]
  /** 抄送用户ID，逗号分隔由前端拼 */
  CcUserIDs?: string[]
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
      CcUserIDs: params.CcUserIDs?.length ? params.CcUserIDs.join(',') : undefined,
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

/** POST /inst/suspend 挂起流程 */
export function suspendInstance(instanceID: number): Promise<{ InstanceID: number; Status: number }> {
  return http.post('/inst/suspend', toForm({ InstanceID: instanceID }))
}

/** POST /inst/resume 恢复流程 */
export function resumeInstance(instanceID: number): Promise<{ InstanceID: number; Status: number }> {
  return http.post('/inst/resume', toForm({ InstanceID: instanceID }))
}

/** POST /inst/urge 催办当前处理人 */
export function urgeInstance(instanceID: number): Promise<{ urged: number }> {
  return http.post('/inst/urge', toForm({ InstanceID: instanceID }))
}

/** POST /inst/terminate 强制终止流程 */
export function terminateInstance(instanceID: number): Promise<string> {
  return http.post('/inst/terminate', toForm({ InstanceID: instanceID }))
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
