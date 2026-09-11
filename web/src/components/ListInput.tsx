import { Select } from 'antd'

/**
 * 字符串数组输入控件（用于处理人、角色、事件名等）。
 * 直接输入回车即生成一个标签，支持逗号/空格分隔。
 */
export default function ListInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <Select
      mode="tags"
      value={value}
      onChange={(next) => onChange(next as string[])}
      placeholder={placeholder}
      disabled={disabled}
      tokenSeparators={[',', '，', ' ', ';', '；']}
      notFoundContent={null}
      style={{ width: '100%' }}
      size="small"
    />
  )
}
