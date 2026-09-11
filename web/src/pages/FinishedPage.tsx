import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Form, Input, Space, Switch, Table, Tag, Typography } from 'antd'
import { EyeOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { listFinishedTasks } from '@/api/task'
import type { WorkflowTask } from '@/types/workflow'
import TaskHandleDrawer from '@/components/TaskHandleDrawer'
import { useCurrentUser } from '@/components/CurrentUserContext'
import { useAsyncData } from '@/hooks/useAsyncData'
import { TASK_STATUS_META } from '@/components/labels'

export default function FinishedPage() {
  const navigate = useNavigate()
  const { userId } = useCurrentUser()
  const [procName, setProcName] = useState('')
  const [ignoreStartByMe, setIgnoreStartByMe] = useState(false)
  const [query, setQuery] = useState({ userid: userId, procname: '', ignorestartbyme: false, asc: false })
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null)

  const { data, loading, error, reload } = useAsyncData<WorkflowTask[]>(
    () =>
      listFinishedTasks({
        userid: query.userid,
        procname: query.procname,
        ignorestartbyme: query.ignorestartbyme,
        asc: query.asc,
        idx: 0,
        rows: 200,
      }),
    [query.userid, query.procname, query.ignorestartbyme, query.asc],
  )

  const columns: ColumnsType<WorkflowTask> = [
    { title: '任务ID', dataIndex: 'TaskID', width: 90 },
    {
      title: '流程名称',
      dataIndex: 'ProcName',
      width: 150,
      render: (name: string, record) => (
        <a onClick={() => navigate(`/instances/${record.ProcInstID}`)}>{name}</a>
      ),
    },
    { title: '业务ID', dataIndex: 'BusinessID', width: 150 },
    {
      title: '节点',
      dataIndex: 'NodeName',
      width: 150,
      render: (name: string, record) => (
        <Space direction="vertical" size={0}>
          <span>{name}</span>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {record.NodeID}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '处理结果',
      dataIndex: 'Status',
      width: 100,
      render: (s: number) => {
        const meta = TASK_STATUS_META[s] || { text: String(s), color: 'default' }
        return <Tag color={meta.color}>{meta.text}</Tag>
      },
    },
    {
      title: '审批意见',
      dataIndex: 'Comment',
      ellipsis: true,
      render: (v: string) => v || <Typography.Text type="secondary">-</Typography.Text>,
    },
    { title: '发起人', dataIndex: 'Starter', width: 110 },
    { title: '处理人', dataIndex: 'UserID', width: 110 },
    { title: '处理时间', dataIndex: 'FinishedTime', width: 170 },
    {
      title: '操作',
      key: 'action',
      width: 90,
      fixed: 'right',
      render: (_, record) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => setActiveTaskId(record.TaskID)}>
          详情
        </Button>
      ),
    },
  ]

  return (
    <Card
      title="已办任务"
      extra={
        <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>
          刷新
        </Button>
      }
    >
      <Form layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item label="处理人">
          <Input
            style={{ width: 160 }}
            value={query.userid}
            onChange={(e) => setQuery((q) => ({ ...q, userid: e.target.value }))}
            placeholder="用户ID，留空查全部"
          />
        </Form.Item>
        <Form.Item label="流程名称">
          <Input
            style={{ width: 180 }}
            value={procName}
            onChange={(e) => setProcName(e.target.value)}
            onPressEnter={() => setQuery((q) => ({ ...q, procname: procName }))}
            placeholder="非必填"
          />
        </Form.Item>
        <Form.Item label="忽略我发起并自己处理的任务">
          <Switch
            checked={ignoreStartByMe}
            onChange={(checked) => {
              setIgnoreStartByMe(checked)
              setQuery((q) => ({ ...q, ignorestartbyme: checked }))
            }}
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
            对应后端 <span className="inline-code">GET /task/finished</span>。任务可能不是本人处理的
            —— 例如会签节点中一人驳回，其余任务会被系统自动标记为已处理。
          </span>
        }
      />

      {error && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={error} />}

      <Table
        rowKey="TaskID"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={data || []}
        scroll={{ x: 1400 }}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        locale={{ emptyText: <Typography.Text type="secondary">暂无已办任务</Typography.Text> }}
      />

      <TaskHandleDrawer
        open={activeTaskId !== null}
        taskId={activeTaskId}
        readOnly
        onClose={() => setActiveTaskId(null)}
      />
    </Card>
  )
}
