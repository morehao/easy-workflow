import { http, toForm, toQuery } from './client'
import type { ProcDef, WorkflowProcess } from '@/types/workflow'

/** POST /def/save 保存/升级流程定义，返回流程ID */
export function saveProcDef(resource: string, createUserID: string): Promise<number> {
  return http.post('/def/save', toForm({ Resource: resource, CreateUserID: createUserID }))
}

/** GET /def/list 获取某来源下的所有流程定义 */
export function listProcDef(source: string): Promise<ProcDef[]> {
  return http.get('/def/list', { params: toQuery({ source }) })
}

/** GET /def/get 获取流程定义（解析后的 Process 对象） */
export function getProcDef(id: number, version?: number): Promise<WorkflowProcess> {
  return http.get('/def/get', { params: toQuery({ id, version }) })
}
