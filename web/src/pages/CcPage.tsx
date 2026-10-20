import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App as AntdApp, Button, Card, Space, Switch, Table, Tag, Typography } from 'antd'
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { listCc, markCcRead, type CcItem } from '@/api/cc'
import { INSTANCE_STATUS_META } from '@/components/labels'
import { useAsyncData } from '@/hooks/useAsyncData'

export default function CcPage() {
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const [unread, setUnread] = useState(false)
  const [selected, setSelected] = useState<React.Key[]>([])
  const { data, loading, reload } = useAsyncData<CcItem[]>(
    () => listCc({ unread, rows: 200 }),
    [unread],
  )

  const markRead = async (ids: number[]) => {
    if (!ids.length) return
    try {
      await markCcRead(ids)
      message.success('已标记为已读')
      setSelected([])
      reload()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const columns: ColumnsType<CcItem> = [
    {
      title: '流程',
      dataIndex: 'ProcName',
      width: 160,
      render: (name: string, r) => <a onClick={() => navigate(`/instances/${r.ProcInstID}`)}>{name}</a>,
    },
    { title: '业务ID', dataIndex: 'BusinessID', width: 150 },
    { title: '发起人', dataIndex: 'Starter', width: 110 },
    {
      title: '当前节点',
      dataIndex: 'CurrentNodeID',
      width: 140,
      render: (v: string, r) =>
        r.InstStatus === 1 ? <Typography.Text type="secondary">已结束</Typography.Text> : <span className="inline-code">{v}</span>,
    },
    {
      title: '实例状态',
      dataIndex: 'InstStatus',
      width: 100,
      render: (s: number) => <Tag color={INSTANCE_STATUS_META[s]?.color}>{INSTANCE_STATUS_META[s]?.text || s}</Tag>,
    },
    {
      title: '抄送状态',
      dataIndex: 'Status',
      width: 100,
      render: (s: number) => (s ? <Tag color="default">已读</Tag> : <Tag color="blue">未读</Tag>),
    },
    { title: '抄送时间', dataIndex: 'CreateTime', width: 170 },
    {
      title: '操作',
      width: 140,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => navigate(`/instances/${r.ProcInstID}`)}>
            查看
          </Button>
          {!r.Status && (
            <Button size="small" type="link" icon={<CheckOutlined />} onClick={() => void markRead([r.ID])}>
              已读
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Card
      title="抄送我的"
      extra={
        <Space>
          <Space size={4}>
            <Typography.Text type="secondary">只看未读</Typography.Text>
            <Switch checked={unread} onChange={setUnread} />
          </Space>
          <Button
            icon={<CheckOutlined />}
            disabled={!selected.length}
            onClick={() => void markRead(selected.map((x) => Number(x)))}
          >
            批量已读
          </Button>
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
        locale={{ emptyText: '暂无抄送' }}
      />
    </Card>
  )
}
