import { Alert, Button, Divider, Input, Space, Tag, Typography } from 'antd'
import type LogicFlow from '@logicflow/core'
import ListInput from '../ListInput'
import {
  GW_MODE_OPTIONS,
  lfTypeToEngine,
  type GwMode,
  type WfEdgeProperties,
  type WfNodeProperties,
} from '@/logicflow/constants'
import { NodeType } from '@/types/workflow'
import { NODE_TYPE_TEXT } from '@/components/labels'

interface Props {
  lf: LogicFlow
  nodeId: string
  /** 属性变更后通知父组件刷新 */
  onChange: () => void
  /** 引擎节点ID 是否与其它节点重复 */
  duplicatedId: boolean
}

/**
 * 读取并更新 LogicFlow 节点上的业务属性。
 * lf.setProperties 会触发节点模型的 setAttributes / getNodeStyle 重新执行，画布即时刷新。
 */
function readNodeProps(lf: LogicFlow, nodeId: string) {
  const model = lf.getNodeModelById(nodeId)
  const props = (model?.getProperties() || {}) as WfNodeProperties
  const patch = (next: Partial<WfNodeProperties>) => {
    lf.setProperties(nodeId, next as Record<string, unknown>)
  }
  return { props, patch }
}

export default function NodePropertyPanel({ lf, nodeId, onChange, duplicatedId }: Props) {
  const { props, patch } = readNodeProps(lf, nodeId)
  const model = lf.getNodeModelById(nodeId)
  if (!model) return null

  const lfType = model.type
  const engineType = lfTypeToEngine(lfType)
  const isStart = engineType === NodeType.Root
  const isTask = engineType === NodeType.Task
  const isGateway = engineType === NodeType.Gateway
  const isEnd = engineType === NodeType.End

  const outgoing = lf.getNodeOutgoingEdge(nodeId)
  const gwMode: GwMode = props.gwMode || 'exclusive'

  const setNodeName = (name: string) => {
    patch({ nodeName: name })
    lf.updateText(nodeId, name)
    onChange()
  }

  const setEdgeExpression = (edgeId: string, expression: string) => {
    const edgeModel = lf.getEdgeModelById(edgeId)
    const edgeProps = (edgeModel?.getProperties() || {}) as WfEdgeProperties
    lf.setProperties(edgeId, { ...edgeProps, expression })
    lf.updateText(edgeId, expression)
    onChange()
  }

  const setEdgeKind = (edgeId: string, branchKind: WfEdgeProperties['branchKind']) => {
    const edgeModel = lf.getEdgeModelById(edgeId)
    const edgeProps = (edgeModel?.getProperties() || {}) as WfEdgeProperties
    lf.setProperties(edgeId, { ...edgeProps, branchKind })
    onChange()
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div>
        <Tag color="blue">{NODE_TYPE_TEXT[engineType]}</Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          LogicFlow 类型 <span className="inline-code">{lfType}</span>
        </Typography.Text>
      </div>

      <div>
        <Typography.Text strong style={{ fontSize: 13 }}>
          节点ID（NodeID）
        </Typography.Text>
        <Input
          size="small"
          value={props.nodeId}
          status={duplicatedId ? 'error' : undefined}
          onChange={(e) => {
            patch({ nodeId: e.target.value })
            onChange()
          }}
          style={{ marginTop: 4 }}
        />
        {duplicatedId ? (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            该节点ID与其它节点重复，保存时会被拦截
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            引擎用它来标识节点，网关条件分支、任务记录都以此为准
          </Typography.Text>
        )}
      </div>

      <div>
        <Typography.Text strong style={{ fontSize: 13 }}>
          节点名称
        </Typography.Text>
        <Input
          size="small"
          value={props.nodeName}
          onChange={(e) => setNodeName(e.target.value)}
          style={{ marginTop: 4 }}
        />
      </div>

      {(isStart || isTask) && (
        <>
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              处理人（UserIDs）
            </Typography.Text>
            <div style={{ marginTop: 4 }}>
              <ListInput
                value={props.userIds || []}
                onChange={(v) => {
                  patch({ userIds: v })
                  onChange()
                }}
                placeholder="输入用户ID后回车"
              />
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {isStart
                ? '开始节点建议填 $starter，引擎会从流程变量 starter 中解析出实际发起人'
                : '直接指定用户ID；若留空则依赖角色或节点开始事件解析'}
            </Typography.Text>
          </div>

          {isTask && (
            <div>
              <Typography.Text strong style={{ fontSize: 13 }}>
                处理角色（Roles）
              </Typography.Text>
              <div style={{ marginTop: 4 }}>
                <ListInput
                  value={props.roles || []}
                  onChange={(v) => {
                    patch({ roles: v })
                    onChange()
                  }}
                  placeholder="如：主管、人事经理"
                />
              </div>
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 6 }}
                message="引擎不知道角色对应哪些用户，必须配置节点开始事件把角色解析成 UserIDs"
              />
            </div>
          )}
        </>
      )}

      {isTask && (
        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>
            是否会签（IsCosigned）
          </Typography.Text>
          <div style={{ marginTop: 4 }}>
            <Space>
              <Button
                size="small"
                type={props.isCosigned ? 'default' : 'primary'}
                onClick={() => {
                  patch({ isCosigned: 0 })
                  onChange()
                }}
              >
                非会签（一人通过即通过）
              </Button>
              <Button
                size="small"
                type={props.isCosigned ? 'primary' : 'default'}
                onClick={() => {
                  patch({ isCosigned: 1 })
                  onChange()
                }}
              >
                会签（全部通过才通过）
              </Button>
            </Space>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            会签节点：全部任务通过才算通过，任意一人驳回即整节点驳回
          </Typography.Text>
        </div>
      )}

      {isGateway && (
        <>
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              网关模式
            </Typography.Text>
            <div style={{ marginTop: 4 }}>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {GW_MODE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    size="small"
                    block
                    type={gwMode === opt.value ? 'primary' : 'default'}
                    style={{ textAlign: 'left', height: 'auto', padding: '6px 10px' }}
                    onClick={() => {
                      patch({ gwMode: opt.value })
                      onChange()
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, opacity: 0.75, whiteSpace: 'normal', lineHeight: 1.4 }}>
                      {opt.tip}
                    </div>
                  </Button>
                ))}
              </Space>
            </div>
          </div>

          {gwMode !== 'parallel' && (
            <div>
              <Typography.Text strong style={{ fontSize: 13 }}>
                汇聚语义（WaitForAllPrevNode）
              </Typography.Text>
              <div style={{ marginTop: 4 }}>
                <Space>
                  <Button
                    size="small"
                    type={props.waitForAllPrevNode ? 'default' : 'primary'}
                    onClick={() => {
                      patch({ waitForAllPrevNode: 0 })
                      onChange()
                    }}
                  >
                    任一上级完成即可往下走
                  </Button>
                  <Button
                    size="small"
                    type={props.waitForAllPrevNode ? 'primary' : 'default'}
                    onClick={() => {
                      patch({ waitForAllPrevNode: 1 })
                      onChange()
                    }}
                  >
                    必须等全部上级完成
                  </Button>
                </Space>
              </div>
            </div>
          )}

          <Divider style={{ margin: '4px 0' }} />

          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              出线分支（{outgoing.length}）
            </Typography.Text>
            {outgoing.length === 0 ? (
              <Alert type="warning" showIcon style={{ marginTop: 6 }} message="网关还没有出线，请从右侧锚点拖出连线" />
            ) : (
              <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 6 }}>
                {outgoing.map((edge) => {
                  const targetNode = lf.getNodeModelById(edge.targetNodeId)
                  const targetProps = (targetNode?.getProperties() || {}) as WfNodeProperties
                  const edgeProps = (edge.getProperties() || {}) as WfEdgeProperties
                  const isCondition =
                    gwMode === 'parallel'
                      ? false
                      : gwMode === 'exclusive'
                        ? true
                        : (edgeProps.branchKind || 'inevitable') === 'condition'
                  return (
                    <div
                      key={edge.id}
                      style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 8 }}
                    >
                      <div style={{ marginBottom: 6, fontSize: 12 }}>
                        <Typography.Text type="secondary">流向 </Typography.Text>
                        <Typography.Text strong>{targetProps.nodeName || edge.targetNodeId}</Typography.Text>
                      </div>

                      {gwMode === 'inclusive' && (
                        <Space size={4} style={{ marginBottom: 6 }}>
                          <Button
                            size="small"
                            type={!isCondition ? 'primary' : 'default'}
                            onClick={() => setEdgeKind(edge.id, 'inevitable')}
                          >
                            必然执行
                          </Button>
                          <Button
                            size="small"
                            type={isCondition ? 'primary' : 'default'}
                            onClick={() => setEdgeKind(edge.id, 'condition')}
                          >
                            条件执行
                          </Button>
                        </Space>
                      )}

                      {isCondition ? (
                        <Input
                          size="small"
                          placeholder="条件表达式，如 $days>=3"
                          value={edgeProps.expression || ''}
                          onChange={(e) => setEdgeExpression(edge.id, e.target.value)}
                        />
                      ) : (
                        <Tag color="green">必然执行</Tag>
                      )}
                    </div>
                  )
                })}
              </Space>
            )}
          </div>
        </>
      )}

      {!isEnd && (
        <>
          <Divider style={{ margin: '4px 0' }} />
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              节点开始事件
            </Typography.Text>
            <div style={{ marginTop: 4 }}>
              <ListInput
                value={props.nodeStartEvents || []}
                onChange={(v) => {
                  patch({ nodeStartEvents: v })
                  onChange()
                }}
                placeholder="事件方法名后回车，如 MyEvent_ResolveRoles"
              />
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              常用于解析角色、发送通知。事件方法必须已在 StartWorkFlow 中注册
            </Typography.Text>
          </div>
        </>
      )}

      {!isEnd && (
        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>
            节点结束事件
          </Typography.Text>
          <div style={{ marginTop: 4 }}>
            <ListInput
              value={props.nodeEndEvents || []}
              onChange={(v) => {
                patch({ nodeEndEvents: v })
                onChange()
              }}
              placeholder="事件方法名后回车"
            />
          </div>
        </div>
      )}

      {isTask && (
        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>
            任务完成事件
          </Typography.Text>
          <div style={{ marginTop: 4 }}>
            <ListInput
              value={props.taskFinishEvents || []}
              onChange={(v) => {
                patch({ taskFinishEvents: v })
                onChange()
              }}
              placeholder="事件方法名后回车"
            />
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            节点内每个任务提交（通过/驳回）时都会触发
          </Typography.Text>
        </div>
      )}
    </Space>
  )
}
