import { Button, Space, Tooltip, Typography } from 'antd'
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons'
import { App as AntdApp } from 'antd'

/** JSON 代码块展示，附带复制与下载 */
export default function JsonViewer({
  value,
  fileName = 'process.json',
  maxHeight,
}: {
  value: unknown
  fileName?: string
  maxHeight?: number
}) {
  const { message } = AntdApp.useApp()
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      message.success('已复制到剪贴板')
    } catch {
      message.error('复制失败，请手动选择文本')
    }
  }

  const handleDownload = () => {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <Space size={8} style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          该 JSON 就是 /def/save 的 <span className="inline-code">Resource</span> 字段内容
        </Typography.Text>
        <Tooltip title="复制">
          <Button size="small" icon={<CopyOutlined />} onClick={handleCopy} />
        </Tooltip>
        <Tooltip title="下载">
          <Button size="small" icon={<DownloadOutlined />} onClick={handleDownload} />
        </Tooltip>
      </Space>
      <pre className="json-viewer" style={maxHeight ? { maxHeight } : undefined}>
        {text}
      </pre>
    </div>
  )
}
