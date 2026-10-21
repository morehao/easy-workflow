import { http, toForm, toQuery } from './client'

export type FormFieldType = 'text' | 'textarea' | 'number' | 'amount' | 'date' | 'select' | 'switch'

export interface FormField {
  name: string
  label: string
  type: FormFieldType
  required?: boolean
  placeholder?: string
  options?: string[]
  min?: number
  max?: number
  maxLength?: number
  default?: unknown
}

export interface FormSchema {
  fields: FormField[]
}

export interface FormTemplate {
  ID: number
  TenantID: string
  ProcDefID: number
  ProcVersion: number
  FormKey: string
  Name: string
  SchemaJSON: string
  Status: number
  CreateTime: string
  UpdateTime: string
}

export interface FormDataRow {
  ID: number
  TenantID: string
  ProcInstID: number
  FormKey: string
  DataJSON: string
  UpdatedBy: string
  UpdateTime: string
}

export interface AttachmentMeta {
  ID: number
  ProcInstID: number
  TaskID: number
  Filename: string
  ContentType: string
  Size: number
  SHA256: string
  UploadedBy: string
  CreateTime: string
}

export function getFormTemplate(procId: number, version?: number, key = 'default'): Promise<FormTemplate> {
  return http.get('/form/template', { params: toQuery({ procid: procId, version, key }) })
}

export function listFormTemplates(procId: number, version?: number): Promise<FormTemplate[]> {
  return http.get('/form/templates', { params: toQuery({ procid: procId, version }) })
}

export function saveFormTemplate(params: {
  procId: number
  version: number
  key?: string
  name?: string
  schema: FormSchema
}): Promise<{ ID: number }> {
  return http.post(
    '/form/template',
    toForm({
      ProcDefID: params.procId,
      ProcVersion: params.version,
      FormKey: params.key || 'default',
      Name: params.name,
      SchemaJSON: JSON.stringify(params.schema),
    }),
  )
}

export function getFormData(instanceId: number, key = 'default', taskId?: number): Promise<FormDataRow> {
  return http.get('/form/data', { params: toQuery({ instid: instanceId, key, taskid: taskId }) })
}

export function saveFormData(params: {
  instanceId: number
  key?: string
  data: Record<string, unknown>
  taskId?: number
}): Promise<{ ID: number }> {
  return http.post(
    '/form/data',
    toForm({
      ProcInstID: params.instanceId,
      FormKey: params.key || 'default',
      TaskID: params.taskId,
      DataJSON: JSON.stringify(params.data),
    }),
  )
}

export function listAttachments(instanceId: number, taskId?: number): Promise<AttachmentMeta[]> {
  return http.get('/attachment/list', { params: toQuery({ instid: instanceId, taskid: taskId }) })
}

export function uploadAttachment(instanceId: number, file: File, taskId?: number): Promise<AttachmentMeta> {
  const data = new FormData()
  data.append('file', file)
  data.append('ProcInstID', String(instanceId))
  if (taskId) data.append('TaskID', String(taskId))
  return http.post('/attachment/upload', data)
}

export function deleteAttachment(id: number): Promise<{ deleted: number }> {
  return http.delete(`/attachment/${id}`)
}

export async function downloadAttachment(id: number): Promise<Blob> {
  return http.get(`/attachment/${id}`, { responseType: 'blob' })
}
