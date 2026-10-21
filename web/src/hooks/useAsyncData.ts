import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 简单的数据加载 hook：处理 loading / error / 重新加载。
 * deps 的长度必须在多次渲染间保持一致（与 useEffect 的要求相同）。
 */
export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loaderRef
      .current()
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return { data, setData, loading, error, reload }
}
