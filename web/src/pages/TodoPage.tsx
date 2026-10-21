import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, App as AntdApp, Button, Card, Form, Input, Space, Table, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { CheckCircleOutlined, ReloadOutlined, SearchOutlined, SolutionOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { batchPassTasks, listTodoTasks } from '@/api/task'
import type { WorkflowTask } from '@/types/workflow'
import TaskHandleDrawer from '@/components/TaskHandleDrawer'
import { useCurrentUser } from '@/components/CurrentUserContext'
import { useAsyncData } from '@/hooks/useAsyncData'

export default function TodoPage() {
  const navigate = useNavigate()
  const { userId } = useCurrentUser()
  const [procName, setProcName] = useState('')
  const [query, setQuery] = useState({ userid: userId, procname: '', asc: true })
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const { message } = AntdApp.useApp()

  const { data, loading, error, reload } = useAsyncData<WorkflowTask[]>(
    () => listTodoTasks({ userid: query.userid, procname: query.procname, asc: query.asc, idx: 0, rows: 200 }),
    [query.userid, query.procname, query.asc],
  )

  const handleBatchPass = async () => {
    if (!selectedRowKeys.length) {
      message.warning('请先选择要批量通过的任务')
      return
    }
    setBatchLoading(true)
    try {
      const res = await batchPassTasks(selectedRowKeys.map((k) => Number(k)))
      if (res.failed?.length) {
        message.warning(`批量完成：成功 ${res.passed.length} 条，失败 ${res.failed.length} 条`)
      } else {
        message.success(`批量通过 ${res.passed.length} 条任务`)
      }
      setSelectedRowKeys([])
      reload()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBatchLoading(false)
    }
  }

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
      title: '当前节点',
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
    { title: '上一节点', dataIndex: 'PrevNodeID', width: 130, render: (v: string) => v || '-' },
    {
      title: '会签',
      dataIndex: 'IsCosigned',
      width: 80,
      render: (v: number) => (v ? <Tag color="red">会签</Tag> : <Tag>普通</Tag>),
    },
    { title: '发起人', dataIndex: 'Starter', width: 110 },
    { title: '任务创建时间', dataIndex: 'CreateTime', width: 170 },
    {
      title: 'SLA',
      dataIndex: 'DueAt',
      width: 150,
      render: (v: string | null, record) => {
        if (!v) return <Typography.Text type="secondary">-</Typography.Text>
        const overdue = record.IsFinished === 0 && dayjs(v).isBefore(dayjs())
        return <Tag color={overdue ? 'red' : 'default'}>{overdue ? `已超时 ${v}` : v}</Tag>
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Button
            size="small"
            type="primary"
            icon={<SolutionOutlined />}
            onClick={() => setActiveTaskId(record.TaskID)}
          >
            处理
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <Card
      title="待办任务"
      extra={
        <Space>
          <Button
            type="primary"
            icon={<CheckCircleOutlined />}
            loading={batchLoading}
            disabled={!selectedRowKeys.length}
            onClick={() => void handleBatchPass()}
          >
            批量通过（{selectedRowKeys.length}）
          </Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>
            刷新
          </Button>
        </Space>
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
            对应后端 <span className="inline-code">GET /task/todo</span>。点「处理」后，
            前端会调用 <span className="inline-code">/task/action</span> 动态获取该任务当前允许的操作
            （通过 / 驳回 / 自由驳回 / 直接提交 / 转办），而不是写死按钮。
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
        scroll={{ x: 1300 }}
        rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        locale={{ emptyText: <Typography.Text type="secondary">当前没有待办任务</Typography.Text> }}
      />

      <TaskHandleDrawer
        open={activeTaskId !== null}
        taskId={activeTaskId}
        onClose={() => setActiveTaskId(null)}
        onSuccess={reload}
      />
    </Card>
  )
}
