import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  RollbackOutlined,
  SwapOutlined,
  UndoOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import {
  getTaskAction,
  getTaskInfo,
  listUpstreamNodes,
  taskFreeReject,
  taskPass,
  taskPassDirectly,
  taskReject,
  taskTransfer,
  addSignTask,
} from '@/api/task'
import type { TaskAction, WorkflowNode, WorkflowTask, WorkflowVariable } from '@/types/workflow'
import KeyValueEditor from './KeyValueEditor'
import ListInput from './ListInput'
import { taskResultMeta } from './labels'

export type TaskActionKind = 'pass' | 'passDirectly' | 'reject' | 'freeReject' | 'transfer' | 'addSign'

const ACTION_META: Record<TaskActionKind, { label: string; icon: ReactNode; danger?: boolean; tip: string }> = {
  pass: {
    label: '通过',
    icon: <CheckCircleOutlined />,
    tip: '任务通过后，按流程定义流转到下一个节点',
  },
  passDirectly: {
    label: '直接提交给驳回我的人',
    icon: <SwapOutlined />,
    tip: '跳过中间节点，直接提交到上一个驳回我的节点（仅非会签节点可用）',
  },
  reject: {
    label: '驳回',
    icon: <CloseCircleOutlined />,
    danger: true,
    tip: '驳回到上一个节点，流程回退一步',
  },
  freeReject: {
    label: '自由驳回',
    icon: <RollbackOutlined />,
    danger: true,
    tip: '驳回到上游任意一个节点，可一步退回给发起人',
  },
  transfer: {
    label: '转办',
    icon: <UndoOutlined />,
    tip: '把任务转交给其他用户处理',
  },
  addSign: {
    label: '加签',
    icon: <UserAddOutlined />,
    tip: '在当前节点追加一个会签处理人；所有人通过后节点才继续流转',
  },
}

interface Props {
  open: boolean
  taskId: number | null
  onClose: () => void
  /** 操作成功后回调（用于刷新列表） */
  onSuccess?: () => void
  /** 只读模式：仅展示任务详情，不显示操作按钮 */
  readOnly?: boolean
}

export default function TaskHandleDrawer({ open, taskId, onClose, onSuccess, readOnly }: Props) {
  const { message } = AntdApp.useApp()

  const [task, setTask] = useState<WorkflowTask | null>(null)
  const [action, setAction] = useState<TaskAction | null>(null)
  const [upstream, setUpstream] = useState<WorkflowNode[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [active, setActive] = useState<TaskActionKind | null>(null)
  const [comment, setComment] = useState('')
  const [variables, setVariables] = useState<WorkflowVariable[]>([])
  const [rejectTo, setRejectTo] = useState<string | undefined>(undefined)
  const [transferUsers, setTransferUsers] = useState<string[]>([])
  const [addSignUser, setAddSignUser] = useState('')

  useEffect(() => {
    if (!open || !taskId) return
    let cancelled = false
    setLoading(true)
    setActive(null)
    setComment('')
    setVariables([])
    setRejectTo(undefined)
    setTransferUsers([])
    setAddSignUser('')

    ;(async () => {
      try {
        const [info, act] = await Promise.all([getTaskInfo(taskId), getTaskAction(taskId)])
        if (cancelled) return
        setTask(info)
        setAction(act)
        if (act.CanFreeRejectToUpstreamNode) {
          const nodes = await listUpstreamNodes(taskId)
          if (!cancelled) setUpstream(nodes || [])
        } else {
          setUpstream([])
        }
      } catch (e) {
        if (!cancelled) message.error((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, taskId, message])

  const availableActions = useMemo<TaskActionKind[]>(() => {
    if (!action) return []
    const list: TaskActionKind[] = []
    if (action.CanPass) list.push('pass')
    if (action.CanDirectlyToWhoRejectedMe) list.push('passDirectly')
    if (action.CanReject) list.push('reject')
    if (action.CanFreeRejectToUpstreamNode) list.push('freeReject')
    if (task && task.IsFinished === 0) list.push('addSign')
    return list
  }, [action, task])

  const transferAllowed = !!action?.CanPass

  const submit = async () => {
    if (!taskId || !active) return
    const vars = variables.filter((v) => v.Key.trim())
    setSubmitting(true)
    try {
      if (active === 'pass') {
        await taskPass(taskId, comment || undefined, vars)
      } else if (active === 'passDirectly') {
        await taskPassDirectly(taskId, comment || undefined, vars)
      } else if (active === 'reject') {
        await taskReject(taskId, comment || undefined, vars)
      } else if (active === 'freeReject') {
        if (!rejectTo) {
          message.warning('请选择要驳回到的节点')
          setSubmitting(false)
          return
        }
        await taskFreeReject(taskId, rejectTo, comment || undefined, vars)
      } else if (active === 'transfer') {
        if (!transferUsers.length) {
          message.warning('请填写转办用户')
          setSubmitting(false)
          return
        }
        await taskTransfer(taskId, transferUsers)
      } else if (active === 'addSign') {
        if (!addSignUser.trim()) {
          message.warning('请填写加签用户')
          setSubmitting(false)
          return
        }
        await addSignTask(taskId, addSignUser.trim(), comment || undefined)
      }
      message.success('操作成功')
      onSuccess?.()
      onClose()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const renderActionForm = () => {
    if (!active) {
      return (
        <Alert
          type="info"
          showIcon
          message="请选择要执行的操作"
          description={
            <span style={{ fontSize: 12 }}>
              后端 <span className="inline-code">/task/action</span> 根据当前任务状态与流程定义，
              动态计算出可执行的操作集合，前端不再硬编码。
            </span>
          }
        />
      )
    }

    const meta = ACTION_META[active]
    return (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert type={meta.danger ? 'warning' : 'info'} showIcon message={meta.tip} />

        {active === 'freeReject' && (
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              驳回到节点 <span style={{ color: '#ff4d4f' }}>*</span>
            </Typography.Text>
            <Select
              style={{ width: '100%', marginTop: 4 }}
              placeholder={upstream.length ? '选择上游节点' : '该任务没有可选的上游节点'}
              value={rejectTo}
              onChange={setRejectTo}
              options={upstream.map((n) => ({
                label: `${n.NodeName}（${n.NodeID}）`,
                value: n.NodeID,
              }))}
              notFoundContent="没有可选的上游节点"
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              自由驳回可以一步退回给任意上游节点，比如直接退给流程发起人
            </Typography.Text>
          </div>
        )}

        {active === 'transfer' && (
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              转办给 <span style={{ color: '#ff4d4f' }}>*</span>
            </Typography.Text>
            <div style={{ marginTop: 4 }}>
              <ListInput
                value={transferUsers}
                onChange={setTransferUsers}
                placeholder="输入用户ID后回车，可多个"
              />
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              多个用户用逗号分隔；转办后原任务会分配给这些用户
            </Typography.Text>
          </div>
        )}

        {active === 'addSign' && (
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              加签用户 <span style={{ color: '#ff4d4f' }}>*</span>
            </Typography.Text>
            <Input
              style={{ marginTop: 4 }}
              value={addSignUser}
              onChange={(e) => setAddSignUser(e.target.value)}
              placeholder="输入用户ID，如 U0002"
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              加签后当前节点变为会签，需所有处理人通过才继续流转。
            </Typography.Text>
          </div>
        )}

        {active !== 'transfer' && active !== 'addSign' && (
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              审批意见
            </Typography.Text>
            <Input.TextArea
              rows={3}
              style={{ marginTop: 4 }}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={active === 'pass' ? '同意' : '请填写驳回原因'}
            />
          </div>
        )}

        {active !== 'transfer' && active !== 'addSign' && (
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              流程变量（可选）
            </Typography.Text>
            <div style={{ marginTop: 4 }}>
              <KeyValueEditor value={variables} onChange={setVariables} />
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              提交后写入实例变量表，后续网关条件表达式可以引用
            </Typography.Text>
          </div>
        )}

        <Space>
          <Button
            type="primary"
            danger={meta.danger}
            icon={meta.icon}
            loading={submitting}
            onClick={submit}
          >
            确认{meta.label}
          </Button>
          <Button onClick={() => setActive(null)}>取消</Button>
        </Space>
      </Space>
    )
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      title={task ? `处理任务 #${task.TaskID}` : '处理任务'}
    >
      <Spin spinning={loading}>
        {task ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="流程">{task.ProcName}</Descriptions.Item>
              <Descriptions.Item label="节点">
                {task.NodeName} <span className="inline-code">{task.NodeID}</span>
              </Descriptions.Item>
              <Descriptions.Item label="业务ID">{task.BusinessID || '-'}</Descriptions.Item>
              <Descriptions.Item label="发起人">{task.Starter}</Descriptions.Item>
              <Descriptions.Item label="处理人">{task.UserID}</Descriptions.Item>
              <Descriptions.Item label="上一节点">{task.PrevNodeID || '-'}</Descriptions.Item>
              <Descriptions.Item label="是否会签">
                {task.IsCosigned ? <Tag color="red">会签节点</Tag> : '否'}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={taskResultMeta(task).color}>{taskResultMeta(task).text}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">{task.CreateTime || '-'}</Descriptions.Item>
              <Descriptions.Item label="处理时间">{task.FinishedTime || '-'}</Descriptions.Item>
              <Descriptions.Item label="审批意见">{task.Comment || '-'}</Descriptions.Item>
            </Descriptions>

            {!readOnly && task.IsFinished === 0 && (
              <>
                <Divider style={{ margin: '4px 0' }}>可执行操作</Divider>

                <Space wrap>
                  {availableActions.map((kind) => {
                    const meta = ACTION_META[kind]
                    return (
                      <Button
                        key={kind}
                        size="small"
                        danger={meta.danger}
                        type={active === kind ? 'primary' : 'default'}
                        icon={meta.icon}
                        onClick={() => setActive(kind)}
                      >
                        {meta.label}
                      </Button>
                    )
                  })}
                  {transferAllowed && (
                    <Button
                      size="small"
                      type={active === 'transfer' ? 'primary' : 'default'}
                      icon={<SwapOutlined />}
                      onClick={() => setActive('transfer')}
                    >
                      转办
                    </Button>
                  )}
                  {!availableActions.length && !transferAllowed && (
                    <Typography.Text type="secondary">
                      当前任务没有可执行的操作（可能已被处理或已转办）
                    </Typography.Text>
                  )}
                </Space>

                {action?.CanRevoke && (
                  <Alert
                    type="info"
                    showIcon
                    message={
                      <span style={{ fontSize: 12 }}>
                        该用户还可以<strong>撤销整个流程实例</strong>，请到「我的发起」中操作。
                      </span>
                    }
                  />
                )}

                {renderActionForm()}
              </>
            )}

            {task.IsFinished === 1 &&
              (task.Status === 0 ? (
                <Alert
                  type="info"
                  showIcon
                  message="该任务已由系统结束"
                  description={
                    <span style={{ fontSize: 12 }}>
                      同一节点的其他处理人已给出结果（非会签节点一人通过即通过），你的任务被系统直接结束，
                      无需再处理。
                    </span>
                  }
                />
              ) : (
                <Alert type="success" showIcon message="该任务已处理完成" />
              ))}
          </Space>
        ) : (
          !loading && <Empty description="没有获取到任务信息" />
        )}
      </Spin>
    </Drawer>
  )
}
