import { useState } from 'react'
import { App as AntdApp, Button, Card, DatePicker, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { createDelegation, disableDelegation, listDelegations, type Delegation } from '@/api/delegation'
import { useAsyncData } from '@/hooks/useAsyncData'

export default function DelegationPage() {
  const { message } = AntdApp.useApp()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toUser, setToUser] = useState('')
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const { data, loading, reload } = useAsyncData<Delegation[]>(() => listDelegations(), [])

  const submit = async () => {
    if (!toUser.trim()) {
      message.warning('请填写受托人')
      return
    }
    setSubmitting(true)
    try {
      await createDelegation({
        toUserID: toUser.trim(),
        startTime: range?.[0]?.format('YYYY-MM-DD'),
        endTime: range?.[1]?.format('YYYY-MM-DD'),
      })
      message.success('委托已创建')
      setOpen(false)
      setToUser('')
      setRange(null)
      reload()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const disable = async (id: number) => {
    try {
      await disableDelegation(id)
      message.success('已停用')
      reload()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const columns: ColumnsType<Delegation> = [
    { title: '委托人', dataIndex: 'FromUserID', width: 120 },
    { title: '受托人', dataIndex: 'ToUserID', width: 120 },
    { title: '开始', dataIndex: 'StartTime', width: 120 },
    { title: '结束', dataIndex: 'EndTime', width: 120 },
    {
      title: '状态',
      dataIndex: 'Status',
      width: 90,
      render: (s: number) => (s ? <Tag color="green">生效中</Tag> : <Tag>已停用</Tag>),
    },
    { title: '创建人', dataIndex: 'CreatedBy', width: 110 },
    {
      title: '操作',
      width: 100,
      render: (_, r) =>
        r.Status ? (
          <Button size="small" danger type="link" onClick={() => void disable(r.ID)}>
            停用
          </Button>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
  ]

  return (
    <Card
      title="任务委托"
      extra={
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            新建委托
          </Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>
            刷新
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        委托生效期内，受托人可在待办中看到并处理委托人的任务；审批记录仍记在原处理人任务上。
      </Typography.Paragraph>
      <Table rowKey="ID" size="small" loading={loading} columns={columns} dataSource={data || []} pagination={{ pageSize: 10 }} />
      <Modal open={open} title="新建委托" onCancel={() => setOpen(false)} onOk={() => void submit()} confirmLoading={submitting}>
        <Form layout="vertical">
          <Form.Item label="受托人用户ID" required>
            <Input value={toUser} onChange={(e) => setToUser(e.target.value)} placeholder="如 U0002" />
          </Form.Item>
          <Form.Item label="生效时间（可选，默认 7 天）">
            <DatePicker.RangePicker
              style={{ width: '100%' }}
              value={range}
              onChange={(v) => setRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
