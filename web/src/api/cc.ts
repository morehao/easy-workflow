import { http, toForm, toQuery } from './client'

export interface CcItem {
  ID: number
  ProcInstID: number
  UserID: string
  Status: number
  CreatedBy: string
  CreateTime: string
  ProcName: string
  BusinessID: string
  Starter: string
  CurrentNodeID: string
  InstStatus: number
}

export function listCc(params?: { unread?: boolean; idx?: number; rows?: number }): Promise<CcItem[]> {
  return http.get('/cc/list', {
    params: toQuery({ unread: params?.unread ? 1 : undefined, idx: params?.idx ?? 0, rows: params?.rows ?? 100 }),
  })
}

export function markCcRead(ids: number[]): Promise<{ read: number }> {
  return http.post('/cc/read', toForm({ IDs: ids.join(',') }))
}

export function addCc(instanceId: number, userIds: string[]): Promise<{ added: number }> {
  return http.post('/cc/add', toForm({ ProcInstID: instanceId, UserIDs: userIds.join(',') }))
}

export interface InstanceCc {
  ID: number
  ProcInstID: number
  UserID: string
  Status: number
  CreatedBy: string
  CreateTime: string
}

export function listInstanceCc(instanceId: number): Promise<InstanceCc[]> {
  return http.get('/cc/instance', { params: toQuery({ instid: instanceId }) })
}
