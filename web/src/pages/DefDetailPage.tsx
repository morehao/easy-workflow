import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Card, Col, Descriptions, Row, Space, Table, Tag, Typography } from 'antd'
import { EditOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { getProcDef, listProcDef } from '@/api/def'
import { NodeType, type ProcDef, type WorkflowNode } from '@/types/workflow'
import { useAsyncData } from '@/hooks/useAsyncData'
import FlowViewer from '@/components/FlowViewer'
import JsonViewer from '@/components/JsonViewer'
import FormTemplateEditor from '@/components/FormTemplateEditor'
import { NODE_TYPE_COLOR, NODE_TYPE_TEXT } from '@/components/labels'
import { SOURCE_STORAGE_KEY } from './DefListPage'

const GW_MODE_TEXT: Record<string, string> = {
  exclusive: '排他（条件分支）',
  parallel: '并行（全部执行）',
  inclusive: '包含（混合）',
}

function inferGwModeText(node: WorkflowNode): string {
  const conditions = node.GWConfig?.Conditions?.length || 0
  const inevitable = node.GWConfig?.InevitableNodes?.length || 0
  if (conditions && inevitable) return GW_MODE_TEXT.inclusive
  if (conditions) return GW_MODE_TEXT.exclusive
  if (inevitable) return node.GWConfig.WaitForAllPrevNode === 1 ? GW_MODE_TEXT.parallel : GW_MODE_TEXT.inclusive
  return '未配置'
}

export default function DefDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const procId = Number(id)

  const { data: process, loading, error } = useAsyncData(() => getProcDef(procId), [procId])

  // 额外查一次列表，用它的 Resource 字段展示后端原样存储的 JSON（未经解析的原始定义）
  const { data: defs } = useAsyncData<ProcDef[]>(
    () => listProcDef(window.localStorage.getItem(SOURCE_STORAGE_KEY) || '办公系统'),
    [],
  )
  const resource = useMemo(() => defs?.find((d) => d.ID === procId)?.Resource || '', [defs, procId])

  const nodes = process?.Nodes || []
  const procVersion = defs?.find((d) => d.ID === procId)?.Version || 0

  const columns: ColumnsType<WorkflowNode> = useMemo(
    () => [
      {
        title: '类型',
        dataIndex: 'NodeType',
        width: 110,
        render: (t: WorkflowNode['NodeType']) => <Tag color={NODE_TYPE_COLOR[t]}>{NODE_TYPE_TEXT[t]}</Tag>,
      },
      {
        title: '节点ID',
        dataIndex: 'NodeID',
        width: 150,
        render: (v: string) => <span className="inline-code">{v}</span>,
      },
      { title: '节点名称', dataIndex: 'NodeName', width: 140 },
      {
        title: '上级节点',
        dataIndex: 'PrevNodeIDs',
        render: (v: string[] | null) =>
          v?.length ? v.map((x) => <Tag key={x}>{x}</Tag>) : <Typography.Text type="secondary">-</Typography.Text>,
      },
      {
        title: '处理人',
        dataIndex: 'UserIDs',
        render: (v: string[] | null) =>
          v?.length ? v.map((x) => <Tag key={x} color="blue">{x}</Tag>) : <Typography.Text type="secondary">-</Typography.Text>,
      },
      {
        title: '角色',
        dataIndex: 'Roles',
        render: (v: string[] | null) =>
          v?.length ? v.map((x) => <Tag key={x} color="geekblue">{x}</Tag>) : <Typography.Text type="secondary">-</Typography.Text>,
      },
      {
        title: '会签',
        dataIndex: 'IsCosigned',
        width: 80,
        render: (v: number) => (v ? <Tag color="red">会签</Tag> : <Typography.Text type="secondary">否</Typography.Text>),
      },
      {
        title: '网关配置',
        key: 'gw',
        width: 190,
        render: (_, node) =>
          node.NodeType === NodeType.Gateway ? (
            <Space direction="vertical" size={2}>
              <Tag color="orange">{inferGwModeText(node)}</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                汇聚：{node.GWConfig?.WaitForAllPrevNode === 1 ? '等全部上级' : '任一上级完成即可'}
              </Typography.Text>
              {(node.GWConfig?.Conditions || []).map((c, i) => (
                <Typography.Text key={i} style={{ fontSize: 11 }}>
                  <span className="inline-code">{c.Expression || '(空)'}</span> → {c.NodeID}
                </Typography.Text>
              ))}
              {(node.GWConfig?.InevitableNodes || []).length > 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  必然执行：{node.GWConfig.InevitableNodes!.join('、')}
                </Typography.Text>
              )}
            </Space>
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          ),
      },
      {
        title: '事件',
        key: 'events',
        render: (_, node) => {
          const events = [
            ...(node.NodeStartEvents || []).map((e) => `开始:${e}`),
            ...(node.NodeEndEvents || []).map((e) => `结束:${e}`),
            ...(node.TaskFinishEvents || []).map((e) => `任务:${e}`),
          ]
          return events.length ? (
            <Space direction="vertical" size={2}>
              {events.map((e) => (
                <Typography.Text key={e} style={{ fontSize: 11 }}>
                  <span className="inline-code">{e}</span>
                </Typography.Text>
              ))}
            </Space>
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          )
        },
      },
    ],
    [],
  )

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card
        size="small"
        loading={loading}
        title={
          <Space>
            <span>流程定义 #{procId}</span>
            {process && <Tag color="blue">{process.ProcessName}</Tag>}
            {process && <Tag>{process.Source}</Tag>}
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => navigate(0)}>
              刷新
            </Button>
            <Button icon={<EditOutlined />} onClick={() => navigate(`/defs/${procId}/edit`)}>
              编辑
            </Button>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => navigate(`/instances/start?procId=${procId}`)}
            >
              发起流程
            </Button>
          </Space>
        }
      >
        {error && <Alert type="error" showIcon message={error} />}
        {process && (
          <Descriptions size="small" column={3} bordered>
            <Descriptions.Item label="流程名称">{process.ProcessName}</Descriptions.Item>
            <Descriptions.Item label="来源">{process.Source}</Descriptions.Item>
            <Descriptions.Item label="节点数">{nodes.length}</Descriptions.Item>
            <Descriptions.Item label="撤销事件" span={3}>
              {process.RevokeEvents?.length
                ? process.RevokeEvents.map((e) => <Tag key={e}>{e}</Tag>)
                : '未配置'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      <FormTemplateEditor procId={procId} version={procVersion} />

      <Row gutter={12}>
        <Col span={24}>
          <Card size="small" title="流程图预览（只读）">
            {process ? (
              <FlowViewer process={process} height={420} showLegend={false} />
            ) : (
              <Typography.Text type="secondary">加载中…</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" title="节点明细">
        <Table
          rowKey="NodeID"
          size="small"
          columns={columns}
          dataSource={nodes}
          loading={loading}
          pagination={false}
          scroll={{ x: 1400 }}
        />
      </Card>

      <Card size="small" title="后端存储的流程定义资源（Resource）">
        {resource ? (
          <JsonViewer value={resource} fileName={`process-${procId}.json`} />
        ) : process ? (
          <JsonViewer value={process} fileName={`process-${procId}.json`} />
        ) : (
          <Typography.Text type="secondary">加载中…</Typography.Text>
        )}
      </Card>
    </Space>
  )
}
