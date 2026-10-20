import axios, { AxiosError } from 'axios'
import { getAccessToken } from '@/auth/token'

/**
 * easy-workflow 后端的响应约定比较特殊：
 *  - 成功：HTTP 200，body 为业务数据（对象/数组/数字/字符串）
 *  - 失败：HTTP 400，body 为 JSON 字符串（即 Go 的 err.Error()）
 *
 * 因此这里统一把错误转换成 Error(message) 抛出，方便页面直接 message.error(e.message)。
 */
const API_BASE = import.meta.env.VITE_API_BASE || '/process'

export const http = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
})

http.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (response) => response.data,
  (error: AxiosError) => {
    const data = error.response?.data
    let msg: string
    if (typeof data === 'string' && data) {
      msg = data
    } else if (data && typeof data === 'object') {
      msg = JSON.stringify(data)
    } else {
      msg = error.message || '网络请求失败'
    }
    return Promise.reject(new Error(msg))
  },
)

/** 把普通对象转成 application/x-www-form-urlencoded 的请求体 */
export function toForm(params: Record<string, string | number | boolean | undefined | null>) {
  const usp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return
    usp.append(k, String(v))
  })
  return usp
}

/** 过滤掉空值，避免后端 strconv 解析空串报错 */
export function toQuery(params: Record<string, string | number | boolean | undefined | null>) {
  const out: Record<string, string | number | boolean> = {}
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    out[k] = v
  })
  return out
}

export { API_BASE }
