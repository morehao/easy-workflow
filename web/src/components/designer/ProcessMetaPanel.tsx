import { Alert, Divider, Input, Space, Typography } from 'antd'
import ListInput from '../ListInput'

export interface ProcessMeta {
  processName: string
  source: string
  revokeEvents: string[]
}

interface Props {
  value: ProcessMeta
  onChange: (next: ProcessMeta) => void
}

export default function ProcessMetaPanel({ value, onChange }: Props) {
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        未选中任何节点。以下是<strong>流程级</strong>配置，点击画布上的节点或连线可编辑其属性。
      </Typography.Text>

      <div>
        <Typography.Text strong style={{ fontSize: 13 }}>
          流程名称
        </Typography.Text>
        <Input
          size="small"
          style={{ marginTop: 4 }}
          value={value.processName}
          placeholder="如：员工请假"
          onChange={(e) => onChange({ ...value, processName: e.target.value })}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          名称 + 来源 唯一确定一个流程定义；同名同来源再次保存会升级版本号
        </Typography.Text>
      </div>

      <div>
        <Typography.Text strong style={{ fontSize: 13 }}>
          流程来源（Source）
        </Typography.Text>
        <Input
          size="small"
          style={{ marginTop: 4 }}
          value={value.source}
          placeholder="如：办公系统"
          onChange={(e) => onChange({ ...value, source: e.target.value })}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          引擎可被多个系统复用，用 Source 隔离不同业务线的流程
        </Typography.Text>
      </div>

      <Divider style={{ margin: '4px 0' }} />

      <div>
        <Typography.Text strong style={{ fontSize: 13 }}>
          流程撤销事件
        </Typography.Text>
        <div style={{ marginTop: 4 }}>
          <ListInput
            value={value.revokeEvents}
            onChange={(revokeEvents) => onChange({ ...value, revokeEvents })}
            placeholder="事件方法名后回车"
          />
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          流程实例被撤销时触发，属于流程级事件而非节点事件
        </Typography.Text>
      </div>

      <Alert
        type="info"
        showIcon
        message="保存前的必填项"
        description={
          <span style={{ fontSize: 12 }}>
            流程名称、来源、创建人ID 三者不能为空（后端 ProcessSave 会校验）。
          </span>
        }
      />
    </Space>
  )
}
