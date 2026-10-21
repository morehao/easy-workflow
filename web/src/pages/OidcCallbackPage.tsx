import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Spin, Typography } from 'antd'
import { useOidc } from '@/auth/oidc'

export default function OidcCallbackPage() {
  const { user, loading, error, login } = useOidc()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  if (error) {
    return (
      <div className="auth-screen">
        <Alert
          type="error"
          showIcon
          message="登录回调失败"
          description={error}
          action={
            <Button type="primary" onClick={() => void login()}>
              重新登录
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <Spin size="large" />
      <Typography.Text type="secondary">{loading ? '正在完成登录…' : '正在跳转…'}</Typography.Text>
    </div>
  )
}
