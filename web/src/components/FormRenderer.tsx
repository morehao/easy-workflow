import { Col, DatePicker, Empty, Form, Input, InputNumber, Row, Select, Switch, Typography } from 'antd'
import dayjs from 'dayjs'
import type { FormField, FormSchema } from '@/api/form'

interface FormRendererProps {
  schema: FormSchema
  value: Record<string, unknown>
  readOnly?: boolean
  onChange?: (value: Record<string, unknown>) => void
}

function fieldValue(value: Record<string, unknown>, name: string): unknown {
  return value?.[name]
}

export default function FormRenderer({ schema, value, readOnly = false, onChange }: FormRendererProps) {
  const fields = schema?.fields || []
  if (!fields.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="表单未配置字段" />

  const setValue = (name: string, v: unknown) => {
    if (readOnly) return
    onChange?.({ ...(value || {}), [name]: v })
  }

  const renderField = (f: FormField) => {
    const current = fieldValue(value, f.name)
    switch (f.type) {
      case 'textarea':
        return (
          <Input.TextArea
            rows={3}
            readOnly={readOnly}
            placeholder={f.placeholder}
            maxLength={f.maxLength}
            showCount={!!f.maxLength}
            value={typeof current === 'string' ? current : ''}
            onChange={(e) => setValue(f.name, e.target.value)}
          />
        )
      case 'number':
      case 'amount':
        return (
          <InputNumber
            style={{ width: '100%' }}
            readOnly={readOnly}
            min={f.min}
            max={f.max}
            placeholder={f.placeholder}
            value={typeof current === 'number' ? current : undefined}
            onChange={(v) => setValue(f.name, v)}
          />
        )
      case 'date':
        return (
          <DatePicker
            style={{ width: '100%' }}
            disabled={readOnly}
            value={typeof current === 'string' && current ? dayjs(current) : undefined}
            onChange={(d) => setValue(f.name, d ? d.format('YYYY-MM-DD') : null)}
          />
        )
      case 'select':
        return (
          <Select
            disabled={readOnly}
            placeholder={f.placeholder}
            value={typeof current === 'string' ? current : undefined}
            options={(f.options || []).map((o) => ({ label: o, value: o }))}
            onChange={(v) => setValue(f.name, v)}
          />
        )
      case 'switch':
        return <Switch checked={!!current} disabled={readOnly} onChange={(v) => setValue(f.name, v)} />
      case 'text':
      default:
        return (
          <Input
            readOnly={readOnly}
            placeholder={f.placeholder}
            maxLength={f.maxLength}
            value={typeof current === 'string' ? current : ''}
            onChange={(e) => setValue(f.name, e.target.value)}
          />
        )
    }
  }

  return (
    <Form layout="vertical" size="small">
      <Row gutter={12}>
        {fields.map((f) => (
          <Col xs={24} md={f.type === 'textarea' ? 24 : 12} key={f.name}>
            <Form.Item
              label={
                <span>
                  {f.label}
                  {f.required && <Typography.Text type="danger"> *</Typography.Text>}
                </span>
              }
            >
              {renderField(f)}
            </Form.Item>
          </Col>
        ))}
      </Row>
    </Form>
  )
}
