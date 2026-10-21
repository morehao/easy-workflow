import { Descriptions, Divider, Input, Radio, Space, Tag, Typography } from 'antd'
import type LogicFlow from '@logicflow/core'
import { LF_NODE_TYPE, type WfEdgeProperties, type WfNodeProperties } from '@/logicflow/constants'

interface Props {
  lf: LogicFlow
  edgeId: string
  onChange: () => void
}

export default function EdgePropertyPanel({ lf, edgeId, onChange }: Props) {
  const edgeModel = lf.getEdgeModelById(edgeId)
  if (!edgeModel) return null

  const edgeProps = (edgeModel.getProperties() || {}) as WfEdgeProperties
  const sourceModel = lf.getNodeModelById(edgeModel.sourceNodeId)
  const targetModel = lf.getNodeModelById(edgeModel.targetNodeId)
  const sourceProps = (sourceModel?.getProperties() || {}) as WfNodeProperties
  const targetProps = (targetModel?.getProperties() || {}) as WfNodeProperties

  const sourceIsGateway = String(sourceModel?.type ?? '') === LF_NODE_TYPE.gateway
  const gwMode = sourceProps.gwMode || 'exclusive'
  const branchKind = edgeProps.branchKind || 'inevitable'

  const setExpression = (expression: string) => {
    lf.setProperties(edgeId, { ...edgeProps, expression })
    lf.updateText(edgeId, expression)
    onChange()
  }

  const patch = (next: Partial<WfEdgeProperties>) => {
    lf.setProperties(edgeId, { ...edgeProps, ...next })
    onChange()
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Tag color="purple">连线</Tag>

      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="起点">
          {sourceProps.nodeName || edgeModel.sourceNodeId}
          {sourceIsGateway && (
            <Tag color="orange" style={{ marginLeft: 6 }}>
              网关
            </Tag>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="终点">{targetProps.nodeName || edgeModel.targetNodeId}</Descriptions.Item>
        <Descriptions.Item label="边ID">
          <span className="inline-code">{edgeId}</span>
        </Descriptions.Item>
      </Descriptions>

      {!sourceIsGateway ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          普通节点之间的连线只表示流转顺序，没有额外配置。分支条件请配置在网关的出线上。
        </Typography.Text>
      ) : (
        <>
          <Divider style={{ margin: 0 }} />
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              分支类型
            </Typography.Text>
            <div style={{ marginTop: 6 }}>
              {gwMode === 'inclusive' ? (
                <Radio.Group
                  size="small"
                  value={branchKind}
                  onChange={(e) => patch({ branchKind: e.target.value })}
                >
                  <Radio.Button value="inevitable">必然执行</Radio.Button>
                  <Radio.Button value="condition">条件执行</Radio.Button>
                </Radio.Group>
              ) : (
                <Tag color={gwMode === 'parallel' ? 'green' : 'blue'}>
                  {gwMode === 'parallel'
                    ? '并行网关：该出线必然执行'
                    : '排他网关：该出线按条件表达式判断'}
                </Tag>
              )}
            </div>
          </div>

          {(gwMode !== 'parallel' && (gwMode === 'exclusive' || branchKind === 'condition')) && (
            <div>
              <Typography.Text strong style={{ fontSize: 13 }}>
                条件表达式
              </Typography.Text>
              <Input
                size="small"
                style={{ marginTop: 4 }}
                placeholder="如 $days>=3"
                value={edgeProps.expression || ''}
                onChange={(e) => setExpression(e.target.value)}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                引擎会把 $变量 替换为流程变量值后计算表达式，支持 &gt;=、&lt;、==、&amp;&amp;、|| 等
              </Typography.Text>
            </div>
          )}

          {gwMode === 'parallel' && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              并行网关的所有出线都会执行；汇聚时 WaitForAllPrevNode=1，需要全部上级节点完成
            </Typography.Text>
          )}
        </>
      )}
    </Space>
  )
}
