import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Modal,
  Row,
  Space,
  Switch,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd'
import { BellOutlined, PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, SaveOutlined, StopOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { getInstanceTaskHistory, listInstanceStartByUser, resumeInstance, revokeInstance, suspendInstance, urgeInstance } from '@/api/inst'
import { getProcDef } from '@/api/def'
import {
  getFormData,
  getFormTemplate,
  saveFormData,
  type FormDataRow,
  type FormSchema,
  type FormTemplate,
} from '@/api/form'
import { computeProgress } from '@/logicflow/convert'
import type { ProcInstance, WorkflowProcess, WorkflowTask } from '@/types/workflow'
import FlowViewer from '@/components/FlowViewer'
import FormRenderer from '@/components/FormRenderer'
import AttachmentPanel from '@/components/AttachmentPanel'
import TaskHandleDrawer from '@/components/TaskHandleDrawer'
import { INSTANCE_STATUS_META, taskResultMeta } from '@/components/labels'
import { useCurrentUser } from '@/components/CurrentUserContext'
import { useAsyncData } from '@/hooks/useAsyncData'

interface HistoryGroup {
  key: string
  nodeId: string
  nodeName: string
  users: string[]
  /** is_finished=1 但 status=0：系统结束时本人并未处理 */
  unhandledUsers: string[]
  rejected: boolean
  finished: boolean
  time: string
  comments: string[]
  batchCode: string
}

export default function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const instId = Number(id)
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const { userId } = useCurrentUser()

  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [force, setForce] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [formSaving, setFormSaving] = useState(false)

  /* ------------------------------- 数据加载 ------------------------------- */

  const {
    data: tasks,
    loading: tasksLoading,
    error: tasksError,
    reload: reloadTasks,
  } = useAsyncData<WorkflowTask[]>(() => getInstanceTaskHistory(instId), [instId])

  const procId = tasks?.[0]?.ProcID
  const starter = tasks?.[0]?.Starter

  const {
    data: instances,
    loading: instanceLoading,
    reload: reloadInstances,
  } = useAsyncData<ProcInstance[]>(
    () => (starter ? listInstanceStartByUser({ userid: starter, rows: 500 }) : Promise.resolve([])),
    [starter],
  )

  const instance = useMemo(
    () => (instances || []).find((i) => i.ProcInstID === instId),
    [instances, instId],
  )
  // 实例钉住的版本：发布新版本后，进度图仍按发起时的定义回显。
  const instanceVersion = instance?.ProcVersion

  const { data: process } = useAsyncData<WorkflowProcess | null>(
    () => (procId ? getProcDef(procId, instanceVersion) : Promise.resolve(null)),
    [procId, instanceVersion],
  )

  const { data: formTemplate } = useAsyncData<FormTemplate | null>(
    () =>
      procId
        ? getFormTemplate(procId, instanceVersion, 'default').catch(() => null)
        : Promise.resolve(null),
    [procId, instanceVersion],
  )
  const formSchema = useMemo<FormSchema | null>(() => {
    if (!formTemplate?.SchemaJSON) return null
    try {
      return JSON.parse(formTemplate.SchemaJSON) as FormSchema
    } catch {
      return null
    }
  }, [formTemplate])

  const { data: formData, reload: reloadFormData } = useAsyncData<FormDataRow | null>(
    () =>
      formTemplate
        ? getFormData(instId, formTemplate.FormKey || 'default').catch(() => null)
        : Promise.resolve(null),
    [formTemplate, instId],
  )

  useEffect(() => {
    if (formData?.DataJSON) {
      try {
        setFormValues(JSON.parse(formData.DataJSON) as Record<string, unknown>)
        return
      } catch {
        // 数据损坏时退回 schema 默认值
      }
    }
    const defaults: Record<string, unknown> = {}
    ;(formSchema?.fields || []).forEach((f) => {
      if (f.default !== undefined && f.default !== null) defaults[f.name] = f.default
    })
    setFormValues(defaults)
  }, [formData, formSchema])

  /* ------------------------------- 进度计算 ------------------------------- */

  const progress = useMemo(() => {
    if (!process) return null
    return computeProgress(process, tasks || [], instance?.Status ?? 0, instance?.CurrentNodeID ?? '')
  }, [process, tasks, instance])

  /* ------------------------------- 审批历史 ------------------------------- */

  const historyGroups = useMemo<HistoryGroup[]>(() => {
    const map = new Map<string, WorkflowTask[]>()
    ;(tasks || []).forEach((t) => {
      const key = `${t.NodeID}#${t.BatchCode || 'default'}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    })

    return Array.from(map.entries())
      .map(([key, list]) => {
        const sorted = [...list].sort((a, b) => a.TaskID - b.TaskID)
        const first = sorted[0]
        const finishedTimes = sorted.map((t) => t.FinishedTime).filter(Boolean) as string[]
        return {
          key,
          nodeId: first.NodeID,
          nodeName: first.NodeName,
          users: Array.from(new Set(sorted.map((t) => t.UserID).filter(Boolean))),
          unhandledUsers: Array.from(
            new Set(
              sorted
                .filter((t) => t.IsFinished === 1 && t.Status === 0)
                .map((t) => t.UserID)
                .filter(Boolean),
            ),
          ),
          rejected: sorted.some((t) => t.Status === 2 && t.IsFinished === 1),
          finished: sorted.every((t) => t.IsFinished === 1),
          time: finishedTimes.length ? finishedTimes.sort()[finishedTimes.length - 1] : (first.CreateTime || ''),
          comments: sorted.map((t) => t.Comment).filter(Boolean),
          batchCode: first.BatchCode || '',
        }
      })
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  }, [tasks])

  const visibleTasks = useMemo(
    () => (selectedNode ? (tasks || []).filter((t) => t.NodeID === selectedNode) : tasks || []),
    [tasks, selectedNode],
  )

  const myActiveTask = useMemo(
    () => (tasks || []).find((t) => t.UserID === userId && t.IsFinished === 0),
    [tasks, userId],
  )
  const canEditForm = !!instance && (instance.Starter === userId || !!myActiveTask)

  const handleSaveForm = async () => {
    if (!formSchema) return
    setFormSaving(true)
    try {
      await saveFormData({
        instanceId: instId,
        key: formTemplate?.FormKey || 'default',
        data: formValues,
        taskId: myActiveTask?.TaskID,
      })
      message.success('表单已保存')
      reloadFormData()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setFormSaving(false)
    }
  }

  const handleSuspend = async () => {
    setActionLoading(true)
    try {
      await suspendInstance(instId)
      message.success('流程已挂起')
      reloadInstances()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleResume = async () => {
    setActionLoading(true)
    try {
      await resumeInstance(instId)
      message.success('流程已恢复')
      reloadInstances()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleUrge = async () => {
    setActionLoading(true)
    try {
      const res = await urgeInstance(instId)
      message.success(`已催办 ${res.urged} 位处理人`)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setActionLoading(false)
    }
  }

  /* -------------------------------- 撤销 -------------------------------- */

  const handleRevoke = async () => {
    setRevoking(true)
    try {
      await revokeInstance(instId, userId || starter || '', force)
      message.success('流程已撤销')
      setRevokeOpen(false)
      setForce(false)
      reloadTasks()
      reloadInstances()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setRevoking(false)
    }
  }

  /* -------------------------------- 表格 -------------------------------- */

  const columns: ColumnsType<WorkflowTask> = [
    { title: '任务ID', dataIndex: 'TaskID', width: 90 },
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
    { title: '处理人', dataIndex: 'UserID', width: 110 },
    {
      title: '结果',
      dataIndex: 'Status',
      width: 100,
      render: (_: number, record) => {
        const meta = taskResultMeta(record)
        return <Tag color={meta.color}>{meta.text}</Tag>
      },
    },
    {
      title: '意见',
      dataIndex: 'Comment',
      ellipsis: true,
      render: (v: string) => v || <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: '批次',
      dataIndex: 'BatchCode',
      width: 130,
      render: (v: string) => <span className="inline-code">{v || '-'}</span>,
    },
    { title: '创建时间', dataIndex: 'CreateTime', width: 170 },
    { title: '处理时间', dataIndex: 'FinishedTime', width: 170 },
    { title: 'SLA截止', dataIndex: 'DueAt', width: 170 },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, record) => (
        <Button size="small" type="link" onClick={() => setActiveTaskId(record.TaskID)}>
          详情
        </Button>
      ),
    },
  ]

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card
        size="small"
        loading={instanceLoading && !instance}
        title={
          <Space wrap>
            <span>流程实例 #{instId}</span>
            {instance && <Tag color="blue">{instance.ProcName}</Tag>}
            {instance && <Tag>v{instance.ProcVersion}</Tag>}
            {instance && (
              <Tag color={INSTANCE_STATUS_META[instance.Status]?.color}>
                {INSTANCE_STATUS_META[instance.Status]?.text}
              </Tag>
            )}
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => { reloadTasks(); reloadInstances() }}>
              刷新
            </Button>
            {instance?.Status === 0 && (
              <>
                <Button icon={<BellOutlined />} loading={actionLoading} onClick={() => void handleUrge()}>
                  催办
                </Button>
                <Button icon={<PauseCircleOutlined />} loading={actionLoading} onClick={() => void handleSuspend()}>
                  挂起
                </Button>
                <Button
                  danger
                  icon={<StopOutlined />}
                  onClick={() => {
                    setForce(true)
                    setRevokeOpen(true)
                  }}
                >
                  终止
                </Button>
                <Button danger icon={<StopOutlined />} onClick={() => { setForce(false); setRevokeOpen(true) }}>
                  撤销
                </Button>
              </>
            )}
            {instance?.Status === 3 && (
              <>
                <Button type="primary" icon={<PlayCircleOutlined />} loading={actionLoading} onClick={() => void handleResume()}>
                  恢复
                </Button>
                <Button
                  danger
                  icon={<StopOutlined />}
                  onClick={() => {
                    setForce(true)
                    setRevokeOpen(true)
                  }}
                >
                  终止
                </Button>
              </>
            )}
            <Button onClick={() => navigate('/tasks/todo')}>去待办</Button>
          </Space>
        }
      >
        {tasksError && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={tasksError} />}
        {instance ? (
          <Descriptions size="small" column={3} bordered>
            <Descriptions.Item label="流程实例ID">{instance.ProcInstID}</Descriptions.Item>
            <Descriptions.Item label="流程定义ID">{instance.ProcID}</Descriptions.Item>
            <Descriptions.Item label="业务ID">{instance.BusinessID || '-'}</Descriptions.Item>
            <Descriptions.Item label="发起人">{instance.Starter}</Descriptions.Item>
            <Descriptions.Item label="当前节点">
              {instance.Status === 1 ? (
                <Typography.Text type="secondary">已结束</Typography.Text>
              ) : (
                <span className="inline-code">{instance.CurrentNodeID}</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">{instance.CreateTime}</Descriptions.Item>
          </Descriptions>
        ) : (
          <Alert
            type="info"
            showIcon
            message="未能获取实例状态"
            description={
              <span style={{ fontSize: 12 }}>
                实例状态通过 <span className="inline-code">GET /inst/start/by?userid=发起人</span>{' '}
                反查得到；若该发起人名下没有实例，请从「我的发起」列表进入详情页。
              </span>
            }
          />
        )}
      </Card>

      <Row gutter={12}>
        <Col xs={24} xl={15}>
          <Card
            size="small"
            title={formTemplate ? `申请单 · ${formTemplate.Name || formTemplate.FormKey}` : '申请单'}
            extra={
              formTemplate && canEditForm ? (
                <Button
                  type="primary"
                  size="small"
                  icon={<SaveOutlined />}
                  loading={formSaving}
                  onClick={() => void handleSaveForm()}
                >
                  保存表单
                </Button>
              ) : null
            }
          >
            {formSchema ? (
              <FormRenderer
                schema={formSchema}
                value={formValues}
                readOnly={!canEditForm}
                onChange={setFormValues}
              />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={formTemplate ? '表单 schema 解析失败，请联系管理员' : '该流程版本未配置表单'}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card size="small" title="附件">
            <AttachmentPanel instanceId={instId} taskId={myActiveTask?.TaskID} canEdit={canEditForm} />
          </Card>
        </Col>
      </Row>

      <Row gutter={12}>
        <Col xs={24} xl={15}>
          <Card
            size="small"
            title="流程图（实时进度）"
            extra={
              selectedNode ? (
                <Button size="small" onClick={() => setSelectedNode(null)}>
                  取消节点筛选
                </Button>
              ) : null
            }
          >
            {process ? (
              <FlowViewer
                process={process}
                nodeStates={progress?.nodeStates}
                edgeStates={progress?.edgeStates}
                nodeUsers={progress?.nodeUsers}
                height={430}
                onNodeClick={(nodeId) =>
                  setSelectedNode((cur) => (cur === nodeId ? null : nodeId))
                }
              />
            ) : (
              <Empty description={tasksLoading ? '加载中…' : '未获取到流程定义'} />
            )}
            {selectedNode && (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 8 }}
                message={
                  <span style={{ fontSize: 12 }}>
                    已筛选节点 <span className="inline-code">{selectedNode}</span>，
                    处理记录：{visibleTasks.length} 条
                  </span>
                }
              />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={9}>
          <Card size="small" title="审批历史（按批次）">
            {historyGroups.length ? (
              <Timeline
                items={historyGroups.map((g) => ({
                  color: g.rejected ? 'red' : g.finished ? 'green' : 'blue',
                  children: (
                    <div>
                      <Space size={6} wrap>
                        <Typography.Text strong>{g.nodeName}</Typography.Text>
                        <Tag color={g.rejected ? 'error' : g.finished ? 'success' : 'processing'}>
                          {g.rejected ? '驳回' : g.finished ? '通过' : '处理中'}
                        </Tag>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          {g.time}
                        </Typography.Text>
                      </Space>
                      <div style={{ fontSize: 12, marginTop: 2 }}>
                        <Typography.Text type="secondary">处理人：</Typography.Text>
                        {g.users.length ? g.users.join('、') : '未分配'}
                        {g.unhandledUsers.length > 0 && (
                          <Typography.Text type="secondary">
                            （{g.unhandledUsers.join('、')} 未处理，节点已由他人处理）
                          </Typography.Text>
                        )}
                      </div>
                      {g.comments.map((c, i) => (
                        <div key={i} style={{ fontSize: 12 }}>
                          <Typography.Text type="secondary">意见：</Typography.Text>
                          {c}
                        </div>
                      ))}
                    </div>
                  ),
                }))}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无审批记录" />
            )}
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title={`任务明细（${visibleTasks.length}）`}
        extra={
          selectedNode ? (
            <Button size="small" onClick={() => setSelectedNode(null)}>
              显示全部
            </Button>
          ) : null
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            <span style={{ fontSize: 12 }}>
              对应后端 <span className="inline-code">GET /inst/task_history?instid=</span>。
              BatchCode 是批次码：同一个节点被驳回后重新流转会产生新批次，因此同一节点可能有多批任务。
            </span>
          }
        />
        <Table
          rowKey="TaskID"
          size="small"
          loading={tasksLoading}
          columns={columns}
          dataSource={visibleTasks}
          scroll={{ x: 1300 }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          locale={{ emptyText: <Typography.Text type="secondary">暂无任务记录</Typography.Text> }}
        />
      </Card>

      <TaskHandleDrawer
        open={activeTaskId !== null}
        taskId={activeTaskId}
        onClose={() => setActiveTaskId(null)}
        onSuccess={reloadTasks}
      />

      <Modal
        open={revokeOpen}
        title={force ? `终止流程实例 #${instId}` : `撤销流程实例 #${instId}`}
        onCancel={() => {
          setRevokeOpen(false)
          setForce(false)
        }}
        onOk={handleRevoke}
        confirmLoading={revoking}
        okText={force ? '确认终止' : '确认撤销'}
        okButtonProps={{ danger: true }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Space>
              <Switch checked={force} onChange={setForce} />
              <Typography.Text>强制撤销（Force）</Typography.Text>
            </Space>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {force
                  ? '强制撤销：不论流程走到哪个节点都直接终止。'
                  : '非强制撤销：只有流程回到发起人节点时才允许撤销。'}
              </Typography.Text>
            </div>
          </div>
          <Alert
            type="warning"
            showIcon
            message="撤销会触发流程级撤销事件，并把实例数据归档到历史表"
          />
        </Space>
      </Modal>
    </Space>
  )
}
