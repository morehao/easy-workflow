import { http, toForm, toQuery } from './client'

export interface Delegation {
  ID: number
  TenantID: string
  FromUserID: string
  ToUserID: string
  StartTime: string
  EndTime: string
  Status: number
  CreatedBy: string
  CreateTime: string
}

export function listDelegations(): Promise<Delegation[]> {
  return http.get('/delegation/list', { params: toQuery({}) })
}

export function createDelegation(params: {
  toUserID: string
  fromUserID?: string
  startTime?: string
  endTime?: string
}): Promise<Delegation> {
  return http.post(
    '/delegation',
    toForm({
      ToUserID: params.toUserID,
      FromUserID: params.fromUserID,
      StartTime: params.startTime,
      EndTime: params.endTime,
    }),
  )
}

export function disableDelegation(id: number): Promise<{ disabled: number }> {
  return http.delete(`/delegation/${id}`)
}
