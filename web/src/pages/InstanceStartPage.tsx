import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  Typography,
} from 'antd'
import { CloudUploadOutlined, ReloadOutlined } from '@ant-design/icons'
import { listProcDef } from '@/api/def'
import { startInstance } from '@/api/inst'
import { useCurrentUser } from '@/components/CurrentUserContext'
import KeyValueEditor from '@/components/KeyValueEditor'
import { useAsyncData } from '@/hooks/useAsyncData'
import type { ProcDef, WorkflowVariable } from '@/types/workflow'
import { SOURCE_STORAGE_KEY } from './DefListPage'

export default function InstanceStartPage() {
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const { userId } = useCurrentUser()
  const [searchParams] = useSearchParams()

  const [source, setSource] = useState(
    () => window.localStorage.getItem(SOURCE_STORAGE_KEY) || '办公系统',
  )
  const [processId, setProcessId] = useState<number | undefined>(
    searchParams.get('procId') ? Number(searchParams.get('procId')) : undefined,
  )
  const [businessId, setBusinessId] = useState('')
  const [comment, setComment] = useState('')
  const [starter, setStarter] = useState(userId)
  const [variables, setVariables] = useState<WorkflowVariable[]>([
    { Key: 'days', Value: '3' },
  ])
  const [submitting, setSubmitting] = useState(false)

  const { data: defs, loading, error, reload } = useAsyncData<ProcDef[]>(
    () => listProcDef(source),
    [source],
  )

  useEffect(() => setStarter(userId), [userId])

  const options = useMemo(
    () =>
      (defs || []).map((d) => ({
        label: `${d.Name}（v${d.Version}，ID ${d.ID}）`,
        value: d.ID,
      })),
    [defs],
  )

  const handleSubmit = async () => {
    if (!processId) {
      message.warning('请选择要发起的流程')
      return
    }
    if (!businessId.trim()) {
      message.warning('业务ID不能为空（后端要求）')
      return
    }
    // 开始节点通常配置 UserIDs=["$starter"]，必须通过变量把发起人传给引擎，
    // 否则 instanceInit 会报「未指定处理人，无法处理节点」。
    const merged: WorkflowVariable[] = [
      { Key: 'starter', Value: starter.trim() },
      ...variables.filter((v) => v.Key.trim()),
    ]
    setSubmitting(true)
    try {
      const instanceId = await startInstance({
        ProcessID: processId,
        BusinessID: businessId.trim(),
        Comment: comment.trim() || undefined,
        Variables: merged,
      })
      message.success(`流程已发起，实例ID ${instanceId}`)
      navigate(`/instances/${instanceId}`)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Row gutter={12}>
      <Col xs={24} lg={15}>
        <Card
          title="发起流程"
          extra={
            <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>
              刷新流程列表
            </Button>
          }
        >
          {error && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={error} />}

          <Form layout="vertical">
            <Form.Item label="流程来源（用于筛选流程定义）">
              <Input
                value={source}
                onChange={(e) => {
                  setSource(e.target.value)
                  setProcessId(undefined)
                }}
                placeholder="如：办公系统"
              />
            </Form.Item>

            <Form.Item label="选择流程定义" required>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder={loading ? '加载中…' : '请选择流程'}
                value={processId}
                onChange={setProcessId}
                options={options}
                notFoundContent="该来源下没有流程定义，请先到「流程定义」中创建"
              />
            </Form.Item>

            <Form.Item
              label="业务ID（BusinessID）"
              required
              extra="业务系统里的单据ID，引擎用它把流程实例和业务数据关联起来"
            >
              <Input
                value={businessId}
                onChange={(e) => setBusinessId(e.target.value)}
                placeholder="如：订单001 / LV20240101"
              />
            </Form.Item>

            <Form.Item label="发起人（流程变量 starter）" required>
              <Input
                value={starter}
                onChange={(e) => setStarter(e.target.value)}
                placeholder="用户ID"
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                开始节点的处理人通常配置为 <span className="inline-code">$starter</span>，
                引擎会从流程变量 <span className="inline-code">starter</span> 中取出实际发起人；
                该用户会成为实例的 Starter，并决定「自由驳回」能回到哪里。
              </Typography.Text>
            </Form.Item>

            <Form.Item label="发起说明（Comment）">
              <Input.TextArea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="如：家中有事请假三天，请领导批准"
              />
            </Form.Item>

            <Form.Item
              label="流程变量"
              extra="网关条件表达式里用 $变量名 引用，例如条件 $days>=3 需要变量 days"
            >
              <KeyValueEditor value={variables} onChange={setVariables} />
            </Form.Item>

            <Form.Item>
              <Space>
                <Button
                  type="primary"
                  icon={<CloudUploadOutlined />}
                  loading={submitting}
                  onClick={handleSubmit}
                >
                  发起流程
                </Button>
                <Button onClick={() => navigate('/defs')}>去创建流程定义</Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>
      </Col>

      <Col xs={24} lg={9}>
        <Card title="接口说明" size="small">
          <Typography.Paragraph style={{ fontSize: 12 }}>
            <span className="inline-code">POST /inst/start</span> 表单字段：
          </Typography.Paragraph>
          <ul style={{ fontSize: 12, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>
              <span className="inline-code">ProcessID</span>：流程定义ID
            </li>
            <li>
              <span className="inline-code">BusinessID</span>：业务ID（必填）
            </li>
            <li>
              <span className="inline-code">Comment</span>：发起说明
            </li>
            <li>
              <span className="inline-code">VariablesJson</span>：
              <span className="inline-code">[{'{'}Key,Value{'}'}]</span> 的 JSON 字符串
            </li>
          </ul>
          <Alert
            type="warning"
            showIcon
            message="注意字段名差异"
            description={
              <span style={{ fontSize: 12 }}>
                <span className="inline-code">/inst/start</span> 用的是{' '}
                <span className="inline-code">VariablesJson</span>（复数），而{' '}
                <span className="inline-code">/task/*</span> 用的是{' '}
                <span className="inline-code">VariableJson</span>（单数）。
                写错字段名后端不会报错，变量会被静默丢弃。
              </span>
            }
          />
        </Card>

        <Card title="发起后的流转" size="small" style={{ marginTop: 12 }}>
          <Typography.Paragraph style={{ fontSize: 12 }}>
            开始节点在引擎里是特殊的任务节点：实例创建后会自动通过，然后按流程定义流转到下一个节点。
          </Typography.Paragraph>
          <Typography.Paragraph style={{ fontSize: 12, marginBottom: 0 }}>
            如果下一个节点是网关，引擎会用流程变量计算条件表达式，决定走哪条分支。
          </Typography.Paragraph>
        </Card>
      </Col>
    </Row>
  )
}
