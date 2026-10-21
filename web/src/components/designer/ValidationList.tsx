import { Alert, Collapse, Empty, List, Space, Tag, Typography } from 'antd'
import type { ValidationIssue } from '@/logicflow/convert'

interface Props {
  issues: ValidationIssue[]
  /** 点击问题项时定位到对应节点 */
  onLocate?: (nodeId: string) => void
}

export default function ValidationList({ issues, onLocate }: Props) {
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')

  if (!issues.length) {
    return <Alert type="success" showIcon message="校验通过，流程定义符合引擎约束" />
  }

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {errors.length > 0 && (
        <Alert
          type="error"
          showIcon
          message={`存在 ${errors.length} 个错误，必须先修复才能保存`}
        />
      )}
      {!errors.length && warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`存在 ${warnings.length} 个警告，不影响保存但可能导致运行时异常`}
        />
      )}

      <Collapse
        size="small"
        defaultActiveKey={['errors', 'warnings']}
        items={[
          errors.length
            ? {
                key: 'errors',
                label: `错误 (${errors.length})`,
                children: (
                  <List
                    size="small"
                    dataSource={errors}
                    renderItem={(item) => (
                      <List.Item
                        style={{ cursor: item.nodeId ? 'pointer' : 'default', paddingLeft: 0 }}
                        onClick={() => item.nodeId && onLocate?.(item.nodeId)}
                      >
                        <Space size={6} align="start">
                          <Tag color="error">错误</Tag>
                          <Typography.Text style={{ fontSize: 12 }}>{item.message}</Typography.Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                ),
              }
            : null,
          warnings.length
            ? {
                key: 'warnings',
                label: `警告 (${warnings.length})`,
                children: (
                  <List
                    size="small"
                    dataSource={warnings}
                    renderItem={(item) => (
                      <List.Item
                        style={{ cursor: item.nodeId ? 'pointer' : 'default', paddingLeft: 0 }}
                        onClick={() => item.nodeId && onLocate?.(item.nodeId)}
                      >
                        <Space size={6} align="start">
                          <Tag color="warning">警告</Tag>
                          <Typography.Text style={{ fontSize: 12 }}>{item.message}</Typography.Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                ),
              }
            : null,
        ].filter(Boolean) as { key: string; label: string; children: React.ReactNode }[]}
      />

      {!issues.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
    </Space>
  )
}
