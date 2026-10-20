import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App as AntdApp, Button, Card, Space, Switch, Table, Tag, Typography } from 'antd'
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from '@/api/notification'
import { useAsyncData } from '@/hooks/useAsyncData'

export default function NotificationPage() {
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const [unread, setUnread] = useState(false)
  const [selected, setSelected] = useState<React.Key[]>([])
  const { data, loading, reload } = useAsyncData<NotificationRow[]>(() => listNotifications(unread), [unread])

  const read = async (ids: number[]) => {
    if (!ids.length) return
    try {
      await markNotificationRead(ids)
      message.success('已读')
      setSelected([])
      reload()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const readAll = async () => {
    try {
      await markAllNotificationsRead()
      message.success('全部已读')
      setSelected([])
      reload()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const columns: ColumnsType<NotificationRow> = [
    {
      title: '标题',
      dataIndex: 'Title',
      width: 180,
      render: (v: string, r) =>
        r.Link ? <a onClick={() => navigate(r.Link)}>{v}</a> : v,
    },
    { title: '内容', dataIndex: 'Body', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'Status',
      width: 90,
      render: (s: number) => (s ? <Tag>已读</Tag> : <Tag color="blue">未读</Tag>),
    },
    { title: '时间', dataIndex: 'CreateTime', width: 170 },
    {
      title: '操作',
      width: 130,
      render: (_, r) => (
        <Space size={4}>
          {r.Link && (
            <Button size="small" type="link" onClick={() => navigate(r.Link)}>
              打开
            </Button>
          )}
          {!r.Status && (
            <Button size="small" type="link" icon={<CheckOutlined />} onClick={() => void read([r.ID])}>
              已读
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Card
      title="站内通知"
      extra={
        <Space>
          <Space size={4}>
            <Typography.Text type="secondary">只看未读</Typography.Text>
            <Switch checked={unread} onChange={setUnread} />
          </Space>
          <Button icon={<CheckOutlined />} disabled={!selected.length} onClick={() => void read(selected.map((x) => Number(x)))}>
            批量已读
          </Button>
          <Button onClick={() => void readAll()}>全部已读</Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>
            刷新
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="ID"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={data || []}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: '暂无通知' }}
      />
    </Card>
  )
}
