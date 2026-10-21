import { useEffect, type ReactNode } from 'react'
import { Alert, Button, Spin, Typography } from 'antd'
import { useCurrentUser } from '@/components/CurrentUserContext'
import { useOidc } from './oidc'

/**
 * 认证门：OIDC 未配置时完全放行（本地开发/现有 e2e 不受影响）；
 * 配置后，未登录展示登录页，登录后把当前 tenant_user.id 注入工作台的“当前用户”。
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const { enabled, loading, error, user, login } = useOidc()
  const { setUserId } = useCurrentUser()

  useEffect(() => {
    if (user?.userId) setUserId(user.userId)
  }, [user?.userId, setUserId])

  if (!enabled) return <>{children}</>

  // 回调页需要在未登录状态下渲染，由 OidcProvider 完成 code 换 token。
  if (window.location.pathname === '/oidc/callback') return <>{children}</>

  if (loading) {
    return (
      <div className="auth-screen">
        <Spin size="large" />
        <Typography.Text type="secondary">正在检查登录状态…</Typography.Text>
      </div>
    )
  }

  if (error) {
    return (
      <div className="auth-screen">
        <Alert
          type="error"
          showIcon
          message="登录失败"
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

  if (!user) {
    return (
      <div className="auth-screen">
        <Typography.Title level={3}>easy-workflow</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ maxWidth: 420, textAlign: 'center' }}>
          使用公司统一身份（ark-iam）登录后进入审批工作台。
        </Typography.Paragraph>
        <Button type="primary" size="large" onClick={() => void login()}>
          使用 ark-iam 登录
        </Button>
      </div>
    )
  }

  return <>{children}</>
}
