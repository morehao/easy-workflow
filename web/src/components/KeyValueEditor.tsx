import { Button, Input, Space } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { WorkflowVariable } from '@/types/workflow'

/**
 * 流程变量编辑器。
 * 后端 /inst/start 与 /task/* 接口都接收 [{Key,Value}] 形式的 JSON 字符串。
 */
export default function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = '变量名（不含 $）',
  valuePlaceholder = '变量值',
}: {
  value: WorkflowVariable[]
  onChange: (next: WorkflowVariable[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  const update = (index: number, patch: Partial<WorkflowVariable>) => {
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  return (
    <Space direction="vertical" size={6} style={{ width: '100%' }}>
      {value.map((item, index) => (
        <Space.Compact key={index} style={{ width: '100%' }}>
          <Input
            size="small"
            style={{ width: '38%' }}
            placeholder={keyPlaceholder}
            value={item.Key}
            onChange={(e) => update(index, { Key: e.target.value })}
          />
          <Input
            size="small"
            placeholder={valuePlaceholder}
            value={item.Value}
            onChange={(e) => update(index, { Value: e.target.value })}
          />
          <Button
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          />
        </Space.Compact>
      ))}
      <Button
        size="small"
        type="dashed"
        icon={<PlusOutlined />}
        onClick={() => onChange([...value, { Key: '', Value: '' }])}
      >
        添加变量
      </Button>
    </Space>
  )
}
