import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Form, Input, Space, Table, Tag, Typography } from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { listProcDef } from '@/api/def'
import type { ProcDef } from '@/types/workflow'
import { useAsyncData } from '@/hooks/useAsyncData'

const SOURCE_STORAGE_KEY = 'easy-workflow:source'

export default function DefListPage() {
  const navigate = useNavigate()
  const [source, setSource] = useState(() => window.localStorage.getItem(SOURCE_STORAGE_KEY) || '办公系统')
  const [committedSource, setCommittedSource] = useState(source)

  const { data, loading, error, reload } = useAsyncData<ProcDef[]>(
    () => listProcDef(committedSource),
    [committedSource],
  )

  const handleSearch = () => {
    window.localStorage.setItem(SOURCE_STORAGE_KEY, source)
    setCommittedSource(source)
  }

  const columns: ColumnsType<ProcDef> = [
    { title: '流程ID', dataIndex: 'ID', width: 90 },
    {
      title: '流程名称',
      dataIndex: 'Name',
      render: (name: string, record) => (
        <a onClick={() => navigate(`/defs/${record.ID}`)}>{name}</a>
      ),
    },
    {
      title: '版本',
      dataIndex: 'Version',
      width: 90,
      render: (v: number) => <Tag color="blue">v{v}</Tag>,
    },
    { title: '来源', dataIndex: 'Source', width: 130 },
    { title: '创建人', dataIndex: 'UserID', width: 110 },
    { title: '创建时间', dataIndex: 'CreatTime', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => navigate(`/defs/${record.ID}`)}>
            查看
          </Button>
          <Button size="small" type="link" onClick={() => navigate(`/defs/${record.ID}/edit`)}>
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            onClick={() => navigate(`/instances/start?procId=${record.ID}`)}
          >
            发起
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <Card
      title="流程定义"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/defs/new')}>
            新建流程
          </Button>
        </Space>
      }
    >
      <Form layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item label="来源（Source）">
          <Input
            style={{ width: 260 }}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onPressEnter={handleSearch}
            placeholder="如：办公系统"
          />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
              查询
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          <span style={{ fontSize: 12 }}>
            对应后端 <span className="inline-code">GET /def/list?source=</span>。引擎可被多个系统复用，
            用 Source 隔离不同业务线的流程；同名同来源再次保存会升级版本号（旧版本进入历史表）。
          </span>
        }
      />

      {error && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={error} />}

      <Table
        rowKey="ID"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={data || []}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        locale={{ emptyText: <Typography.Text type="secondary">该来源下还没有流程定义，点击右上角「新建流程」开始设计</Typography.Text> }}
      />
    </Card>
  )
}

export { SOURCE_STORAGE_KEY }
