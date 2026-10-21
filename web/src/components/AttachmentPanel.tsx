import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Button, Empty, Popconfirm, Space, Table, Typography, Upload } from 'antd'
import { DeleteOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadRequestOption } from 'rc-upload/lib/interface'
import {
  deleteAttachment,
  downloadAttachment,
  listAttachments,
  uploadAttachment,
  type AttachmentMeta,
} from '@/api/form'

interface AttachmentPanelProps {
  instanceId: number
  taskId?: number
  canEdit?: boolean
}

function formatBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export default function AttachmentPanel({ instanceId, taskId, canEdit = false }: AttachmentPanelProps) {
  const { message } = AntdApp.useApp()
  const [list, setList] = useState<AttachmentMeta[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setList((await listAttachments(instanceId, taskId)) || [])
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [instanceId, taskId, message])

  useEffect(() => {
    void load()
  }, [load])

  const customUpload = async (options: UploadRequestOption) => {
    const file = options.file as File
    try {
      await uploadAttachment(instanceId, file, taskId)
      message.success('上传成功')
      options.onSuccess?.({}, file as unknown as XMLHttpRequest)
      await load()
    } catch (e) {
      message.error((e as Error).message)
      options.onError?.(e as Error)
    }
  }

  const handleDownload = async (row: AttachmentMeta) => {
    try {
      const blob = await downloadAttachment(row.ID)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = row.Filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const handleDelete = async (row: AttachmentMeta) => {
    try {
      await deleteAttachment(row.ID)
      message.success('已删除')
      await load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {canEdit && (
        <Upload customRequest={customUpload} showUploadList={false}>
          <Button icon={<UploadOutlined />}>上传附件</Button>
        </Upload>
      )}
      {list.length ? (
        <Table
          rowKey="ID"
          size="small"
          loading={loading}
          pagination={false}
          dataSource={list}
          columns={[
            { title: '文件名', dataIndex: 'Filename', ellipsis: true },
            { title: '大小', dataIndex: 'Size', width: 90, render: (v: number) => formatBytes(v) },
            { title: '上传人', dataIndex: 'UploadedBy', width: 100 },
            { title: '时间', dataIndex: 'CreateTime', width: 160 },
            {
              title: '操作',
              width: 100,
              render: (_, row) => (
                <Space size={4}>
                  <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => void handleDownload(row)}>
                    下载
                  </Button>
                  {canEdit && (
                    <Popconfirm title="删除该附件？" onConfirm={() => void handleDelete(row)}>
                      <Button type="link" danger size="small" icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '加载中…' : '暂无附件'} />
      )}
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        支持图片、PDF、Office、文本；单文件上限由后端配置。
      </Typography.Text>
    </Space>
  )
}
