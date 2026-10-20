import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { setTokenProvider } from './token'

/**
 * 轻量 OIDC 授权码 + PKCE 客户端。
 *
 * 不引入额外依赖，避免与 ark-iam 的联调被 npm 包版本/网络阻塞；
 * 生产若需要 silent renew / 多标签页同步，可替换为 oidc-client-ts。
 *
 * 环境变量：
 *  - VITE_OIDC_AUTHORITY   例如 https://iam.example.com/oidc
 *  - VITE_OIDC_CLIENT_ID   例如 workflow_web
 *  - VITE_OIDC_REDIRECT_URI 默认 `${origin}/oidc/callback`
 *  - VITE_OIDC_SCOPE       默认 openid profile
 *  - VITE_OIDC_END_SESSION 可选，默认 `${authority}/end_session`
 */
const AUTHORITY = (import.meta.env.VITE_OIDC_AUTHORITY as string | undefined)?.replace(/\/+$/, '')
const CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined
const REDIRECT_URI =
  (import.meta.env.VITE_OIDC_REDIRECT_URI as string | undefined) || `${window.location.origin}/oidc/callback`
const SCOPE = (import.meta.env.VITE_OIDC_SCOPE as string | undefined) || 'openid profile email offline_access'
const END_SESSION =
  (import.meta.env.VITE_OIDC_END_SESSION as string | undefined) ||
  (AUTHORITY ? `${AUTHORITY}/end_session` : '')

const USER_KEY = 'easy-workflow:oidc-user'
const PKCE_KEY = 'easy-workflow:oidc-pkce'

export const oidcEnabled = Boolean(AUTHORITY && CLIENT_ID)

export interface OidcUser {
  accessToken: string
  idToken?: string
  refreshToken?: string
  expiresAt: number
  userId: string
  tenantId: string
  name: string
  profile: Record<string, unknown>
}

interface OidcContextValue {
  enabled: boolean
  loading: boolean
  error: string | null
  user: OidcUser | null
  login: () => Promise<void>
  logout: () => void
  getAccessToken: () => string | undefined
}

const OidcContext = createContext<OidcContextValue>({
  enabled: false,
  loading: false,
  error: null,
  user: null,
  login: async () => undefined,
  logout: () => undefined,
  getAccessToken: () => undefined,
})

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(size = 32): string {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function sha256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1] || ''
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  } catch {
    return {}
  }
}

function userFromTokenResponse(raw: Record<string, unknown>): OidcUser {
  const accessToken = String(raw.access_token || '')
  const profile = decodeJwtPayload(accessToken)
  const expiresIn = Number(raw.expires_in || 900)
  return {
    accessToken,
    idToken: raw.id_token ? String(raw.id_token) : undefined,
    refreshToken: raw.refresh_token ? String(raw.refresh_token) : undefined,
    expiresAt: Date.now() + expiresIn * 1000,
    userId: String(profile.user_id || profile.sub || ''),
    tenantId: String(profile.tenant_id || ''),
    name: String(profile.name || profile.preferred_username || profile.sub || ''),
    profile,
  }
}

function readStoredUser(): OidcUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as OidcUser
    if (!parsed.accessToken) return null
    return parsed
  } catch {
    return null
  }
}

function storeUser(user: OidcUser | null): void {
  if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user))
  else sessionStorage.removeItem(USER_KEY)
}

async function postToken(body: Record<string, string>): Promise<Record<string, unknown>> {
  const resp = await fetch(`${AUTHORITY}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  const text = await resp.text()
  if (!resp.ok) {
    throw new Error(`token endpoint ${resp.status}: ${text.slice(0, 300)}`)
  }
  return JSON.parse(text) as Record<string, unknown>
}

async function beginLogin(): Promise<void> {
  if (!oidcEnabled) return
  const verifier = randomString(64)
  const challenge = await sha256Challenge(verifier)
  const state = randomString(24)
  const nonce = randomString(24)
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, nonce, redirectUri: REDIRECT_URI }))
  const url = new URL(`${AUTHORITY}/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CLIENT_ID!)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  window.location.assign(url.toString())
}

async function completeLogin(code: string, state: string): Promise<OidcUser> {
  const raw = sessionStorage.getItem(PKCE_KEY)
  if (!raw) throw new Error('登录状态已丢失，请重新登录')
  const pkce = JSON.parse(raw) as { verifier: string; state: string; nonce: string; redirectUri: string }
  if (pkce.state !== state) throw new Error('登录 state 不匹配，请重新登录')
  const token = await postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: pkce.redirectUri,
    client_id: CLIENT_ID!,
    code_verifier: pkce.verifier,
  })
  if (token.id_token) {
    const idPayload = decodeJwtPayload(String(token.id_token))
    if (idPayload.nonce && idPayload.nonce !== pkce.nonce) {
      throw new Error('登录 nonce 不匹配，请重新登录')
    }
  }
  sessionStorage.removeItem(PKCE_KEY)
  const user = userFromTokenResponse(token)
  storeUser(user)
  return user
}

async function refreshUser(user: OidcUser): Promise<OidcUser | null> {
  if (!user.refreshToken) return null
  try {
    const token = await postToken({
      grant_type: 'refresh_token',
      refresh_token: user.refreshToken,
      client_id: CLIENT_ID!,
    })
    const next = userFromTokenResponse(token)
    storeUser(next)
    return next
  } catch {
    storeUser(null)
    return null
  }
}

export function OidcProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<OidcUser | null>(() => (oidcEnabled ? readStoredUser() : null))
  const [loading, setLoading] = useState(oidcEnabled)
  const [error, setError] = useState<string | null>(null)
  const refreshTimer = useRef<number | null>(null)

  useLayoutEffect(() => {
    setTokenProvider(() => user?.accessToken)
  }, [user])

  useEffect(() => {
    if (!oidcEnabled) return
    let cancelled = false
    ;(async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')
        const state = params.get('state')
        if (window.location.pathname === '/oidc/callback') {
          if (!code || !state) throw new Error('登录回调缺少 code/state')
          const next = await completeLogin(code, state)
          if (!cancelled) setUser(next)
          return
        }
        const stored = readStoredUser()
        if (stored && stored.expiresAt > Date.now() + 5_000) {
          if (!cancelled) setUser(stored)
          return
        }
        if (stored?.refreshToken) {
          const next = await refreshUser(stored)
          if (!cancelled) setUser(next)
          return
        }
        if (!cancelled) setUser(null)
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message)
          setUser(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 到期前 2 分钟刷新；失败则清空并让 AuthGate 重新登录。
  useEffect(() => {
    if (!oidcEnabled || !user) return
    if (refreshTimer.current) window.clearInterval(refreshTimer.current)
    refreshTimer.current = window.setInterval(async () => {
      if (user.expiresAt - Date.now() > 120_000) return
      const next = await refreshUser(user)
      setUser(next)
    }, 30_000)
    return () => {
      if (refreshTimer.current) window.clearInterval(refreshTimer.current)
    }
  }, [user])

  const login = useCallback(async () => {
    setError(null)
    try {
      await beginLogin()
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const logout = useCallback(() => {
    storeUser(null)
    sessionStorage.removeItem(PKCE_KEY)
    setUser(null)
    if (END_SESSION) {
      const url = new URL(END_SESSION)
      url.searchParams.set('post_logout_redirect_uri', `${window.location.origin}/`)
      window.location.assign(url.toString())
    }
  }, [])

  const getAccessToken = useCallback(() => user?.accessToken, [user])

  const value = useMemo<OidcContextValue>(
    () => ({ enabled: oidcEnabled, loading, error, user, login, logout, getAccessToken }),
    [loading, error, user, login, logout, getAccessToken],
  )

  return <OidcContext.Provider value={value}>{children}</OidcContext.Provider>
}

export function useOidc(): OidcContextValue {
  return useContext(OidcContext)
}
