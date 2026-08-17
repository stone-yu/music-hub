/**
 * 适配器请求层 — 替代上游 src/renderer/utils/request.js 的 httpFetch
 * 返回 { promise, abort }，与上游调用习惯保持一致，便于逐文件移植
 */
import needle from 'needle'

export interface HttpResponse<T = unknown> {
  statusCode?: number
  headers: Record<string, unknown>
  body: T
}

export interface RequestObj<T = unknown> {
  promise: Promise<HttpResponse<T>>
  abort: () => void
}

const DEFAULT_TIMEOUT = 15_000

export function httpFetch<T = any>(
  url: string,
  options: {
    method?: 'get' | 'post'
    headers?: Record<string, string>
    body?: unknown
    form?: unknown
    timeout?: number
  } = {},
): RequestObj<T> {
  const { method = 'get', headers, body, form, timeout = DEFAULT_TIMEOUT } = options
  const needleOpts: Record<string, unknown> = {
    headers,
    response_timeout: timeout,
    open_timeout: timeout,
    follow_max: 5,
    compressed: true,
  }
  let data: unknown = null
  if (body) data = body
  else if (form) {
    data = form
    needleOpts.json = false
  }
  if (method === 'post' && body && typeof body === 'object') needleOpts.json = true

  let aborted = false
  let reqRef: { abort?: () => void } | null = null

  const promise = new Promise<HttpResponse<T>>((resolve, reject) => {
    const stream = needle.request(method, url, data as never, needleOpts as never, (err, resp) => {
      if (aborted) return reject(new Error('aborted'))
      if (err) return reject(err)
      // needle 已按 content-encoding 解压；body 可能是对象(JSON)/字符串/Buffer
      let respBody: unknown = resp.body
      if (Buffer.isBuffer(respBody)) respBody = respBody.toString()
      if (typeof respBody === 'string') {
        try {
          respBody = JSON.parse(respBody)
        } catch {
          /* keep as string */
        }
      }
      resolve({ statusCode: resp.statusCode, headers: resp.headers as Record<string, unknown>, body: respBody as T })
    })
    reqRef = (stream as unknown as { request?: { abort: () => void } }).request ?? null
  })

  return {
    promise,
    abort: () => {
      aborted = true
      reqRef?.abort?.()
    },
  }
}
