import { http, toForm, toQuery } from './client'

export interface NotificationRow {
  ID: number
  TenantID: string
  UserID: string
  Title: string
  Body: string
  Link: string
  Status: number
  CreateTime: string
}

export function listNotifications(unread = false): Promise<NotificationRow[]> {
  return http.get('/notification/list', { params: toQuery({ unread: unread ? 1 : undefined, rows: 100 }) })
}

export function unreadNotificationCount(): Promise<{ count: number }> {
  return http.get('/notification/unread-count')
}

export function markNotificationRead(ids: number[]): Promise<{ read: number }> {
  return http.post('/notification/read', toForm({ IDs: ids.join(',') }))
}

export function markAllNotificationsRead(): Promise<{ read: number }> {
  return http.post('/notification/read-all')
}
