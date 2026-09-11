import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import { ReloadOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { listInstanceStartByUser, revokeInstance } from '@/api/inst'
import type { ProcInstance } from '@/types/workflow'
import { INSTANCE_STATUS_META } from '@/components/labels'
import { useCurrentUser } from '@/components/CurrentUserContext'
import { useAsyncData } from '@/hooks/useAsyncData'

export default function MyInstancesPage() {
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const { userId } = useCurrentUser()

  const [procName, setProcName] = useState('')
  const [query, setQuery] = useState({ userid: userId, procname: '' })
  const [revokeTarget, setRevokeTarget] = useState<ProcInstance | null>(null)
  const [force, setForce] = useState(false)
  const [revoking, setRevoking] = useState(false)

  const { data, loading, error, reload } = useAsyncData<ProcInstance[]>(
    () => listInstanceStartByUser({ userid: query.userid, procname: query.procname, idx: 0, rows: 200 }),
    [query.userid, query.procname],
  )

  const handleRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      await revokeInstance(revokeTarget.ProcInstID, userId, force)
      message.success('流程已撤销')
      setRevokeTarget(null)
      setForce(false)
      reload()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setRevoking(false)
    }
  }

  const columns: ColumnsType<ProcInstance> = [
    { title: '实例ID', dataIndex: 'ProcInstID', width: 90 },
    {
      title: '流程名称',
      dataIndex: 'ProcName',
      render: (name: string, record) => <a onClick={() => navigate(`/instances/${record.ProcInstID}`)}>{name}</a>,
    },
    { title: '版本', dataIndex: 'ProcVersion', width: 80, render: (v: number) => <Tag>v{v}</Tag> },
    { title: '业务ID', dataIndex: 'BusinessID', width: 160 },
    { title: '发起人', dataIndex: 'Starter', width: 110 },
    {
      title: '当前节点',
      dataIndex: 'CurrentNodeID',
      width: 150,
      render: (v: string, record) =>
        // 流程已结束时这个字段没有意义：老数据的 current_node_id 还停在进入结束节点之前的节点上
        record.Status === 1 ? (
          <Typography.Text type="secondary">已结束</Typography.Text>
        ) : (
          <span className="inline-code">{v}</span>
        ),
    },
    { title: '创建时间', dataIndex: 'CreateTime', width: 170 },
    {
      title: '状态',
      dataIndex: 'Status',
      width: 100,
      render: (s: number) => {
        const meta = INSTANCE_STATUS_META[s] || { text: String(s), color: 'default' }
        return <Tag color={meta.color}>{meta.text}</Tag>
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => navigate(`/instances/${record.ProcInstID}`)}>
            详情
          </Button>
          {record.Status === 0 && (
            <Button
              size="small"
              type="link"
              danger
              icon={<StopOutlined />}
              onClick={() => setRevokeTarget(record)}
            >
              撤销
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Card
      title="我的发起"
      extra={
        <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>
          刷新
        </Button>
      }
    >
      <Form layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item label="发起人">
          <Input
            style={{ width: 160 }}
            value={query.userid}
            onChange={(e) => setQuery((q) => ({ ...q, userid: e.target.value }))}
            placeholder="用户ID，留空查全部"
          />
        </Form.Item>
        <Form.Item label="流程名称">
          <Input
            style={{ width: 200 }}
            value={procName}
            onChange={(e) => setProcName(e.target.value)}
            onPressEnter={() => setQuery((q) => ({ ...q, procname: procName }))}
            placeholder="非必填"
          />
        </Form.Item>
        <Form.Item>
          <Button
            type="primary"
            icon={<SearchOutlined />}
            onClick={() => setQuery((q) => ({ ...q, procname: procName }))}
          >
            查询
          </Button>
        </Form.Item>
      </Form>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          <span style={{ fontSize: 12 }}>
            对应后端 <span className="inline-code">GET /inst/start/by</span>。切换顶栏「当前用户」即可查看
            以该用户发起的流程实例。
          </span>
        }
      />

      {error && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={error} />}

      <Table
        rowKey="ProcInstID"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={data || []}
        scroll={{ x: 1200 }}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        locale={{ emptyText: <Typography.Text type="secondary">暂无流程实例</Typography.Text> }}
      />

      <Modal
        open={!!revokeTarget}
        title={`撤销流程实例 #${revokeTarget?.ProcInstID ?? ''}`}
        onCancel={() => {
          setRevokeTarget(null)
          setForce(false)
        }}
        onOk={handleRevoke}
        confirmLoading={revoking}
        okText="确认撤销"
        okButtonProps={{ danger: true }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text>
            流程：<strong>{revokeTarget?.ProcName}</strong>（业务ID {revokeTarget?.BusinessID}）
          </Typography.Text>
          <div>
            <Space>
              <Switch checked={force} onChange={setForce} />
              <Typography.Text>强制撤销（Force）</Typography.Text>
            </Space>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {force
                  ? '强制撤销：不论流程当前走到哪个节点，都直接终止实例。'
                  : '非强制撤销：只有流程回到发起人（Starter）节点时才允许撤销，否则后端会报错。'}
              </Typography.Text>
            </div>
          </div>
          <Alert type="warning" showIcon message="撤销后实例状态变为「已撤销」，并会触发流程级的撤销事件" />
        </Space>
      </Modal>
    </Card>
  )
}
