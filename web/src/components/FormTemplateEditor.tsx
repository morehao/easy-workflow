import { useEffect, useState } from 'react'
import { App as AntdApp, Button, Card, Input, Space, Typography } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { listFormTemplates, saveFormTemplate, type FormSchema, type FormTemplate } from '@/api/form'

const SAMPLE: FormSchema = {
  fields: [
    { name: 'title', label: '标题', type: 'text', required: true, maxLength: 100 },
    { name: 'reason', label: '事由', type: 'textarea', required: true, maxLength: 500 },
  ],
}

interface FormTemplateEditorProps {
  procId: number
  version: number
}

export default function FormTemplateEditor({ procId, version }: FormTemplateEditorProps) {
  const { message } = AntdApp.useApp()
  const [text, setText] = useState(JSON.stringify(SAMPLE, null, 2))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [existing, setExisting] = useState<FormTemplate | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const list = await listFormTemplates(procId, version || undefined)
        const current = list.find((t) => t.FormKey === 'default') || list[0]
        if (!cancelled && current) {
          setExisting(current)
          setText(current.SchemaJSON)
        }
      } catch {
        // 未配置表单时保留示例
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [procId, version])

  const handleSave = async () => {
    let schema: FormSchema
    try {
      schema = JSON.parse(text) as FormSchema
    } catch {
      message.error('JSON 解析失败')
      return
    }
    setSaving(true)
    try {
      await saveFormTemplate({ procId, version: version || 0, key: 'default', name: existing?.Name || '申请单', schema })
      message.success('表单模板已保存')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      size="small"
      title="申请单表单模板"
      loading={loading}
      extra={
        <Button type="primary" size="small" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
          保存模板
        </Button>
      }
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          字段类型：text/textarea/number/amount/date/select/switch；required、options、min/max、maxLength。
          模板按流程版本保存，在途实例仍用原版本。
        </Typography.Text>
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoSize={{ minRows: 10, maxRows: 24 }}
          spellCheck={false}
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
        />
      </Space>
    </Card>
  )
}
