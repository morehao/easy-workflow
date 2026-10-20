/**
 * 访问令牌提供者：由 OIDC Provider 在登录后注入，axios 请求拦截器读取。
 *
 * 单独放在这里是为了避免 client.ts 直接依赖 React/OIDC 模块造成循环依赖。
 */
let provider: () => string | undefined = () => undefined

export function setTokenProvider(fn: () => string | undefined): void {
  provider = fn
}

export function getAccessToken(): string | undefined {
  return provider()
}
