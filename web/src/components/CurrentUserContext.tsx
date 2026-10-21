import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'easy-workflow:current-user'

interface CurrentUserValue {
  /** 当前登录用户ID，作为所有 /task、/inst 接口的 userid 参数 */
  userId: string
  setUserId: (id: string) => void
}

const CurrentUserContext = createContext<CurrentUserValue>({
  userId: '',
  setUserId: () => undefined,
})

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [userId, setUserIdState] = useState<string>(
    () => window.localStorage.getItem(STORAGE_KEY) || 'U0001',
  )

  const setUserId = useCallback((id: string) => {
    const next = id.trim()
    window.localStorage.setItem(STORAGE_KEY, next)
    setUserIdState(next)
  }, [])

  const value = useMemo(() => ({ userId, setUserId }), [userId, setUserId])

  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>
}

export function useCurrentUser() {
  return useContext(CurrentUserContext)
}
