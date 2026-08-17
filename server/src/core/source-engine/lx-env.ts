/**
 * lx 环境模拟 — 依据 lx-music-desktop@9c364b4
 * src/main/modules/userApi/renderer/preload.js 逐项复刻
 *
 * 音源脚本视角的 globalThis.lx：
 *   - EVENT_NAMES { request, inited, updateAlert }
 *   - send(eventName, data) → Promise
 *   - on(eventName, handler)
 *   - request(url, options, callback) → abort()
 *   - utils.crypto { aesEncrypt, rsaEncrypt, randomBytes, md5 }
 *   - utils.buffer { from, bufToString }
 *   - utils.zlib { inflate, deflate }
 *   - currentScriptInfo / version '2.0.0' / env 'desktop'
 */
import { createCipheriv, publicEncrypt, constants, randomBytes, createHash } from 'node:crypto'
import zlib from 'node:zlib'
import needle from 'needle'

export const EVENT_NAMES = {
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert',
} as const

export const ALL_SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg', 'local'] as const
export type PlatformId = (typeof ALL_SOURCES)[number]
export type Quality = '128k' | '320k' | 'flac' | 'flac24bit'
export type SourceAction = 'musicUrl' | 'lyric' | 'pic'

const SUPPORT_QUALITYS: Record<string, Quality[]> = {
  kw: ['128k', '320k', 'flac', 'flac24bit'],
  kg: ['128k', '320k', 'flac', 'flac24bit'],
  tx: ['128k', '320k', 'flac', 'flac24bit'],
  wy: ['128k', '320k', 'flac', 'flac24bit'],
  mg: ['128k', '320k', 'flac', 'flac24bit'],
  local: [],
}
const SUPPORT_ACTIONS: Record<string, SourceAction[]> = {
  kw: ['musicUrl'],
  kg: ['musicUrl'],
  tx: ['musicUrl'],
  wy: ['musicUrl'],
  mg: ['musicUrl'],
  local: ['musicUrl', 'lyric', 'pic'],
}

export interface ScriptInfo {
  name: string
  description: string
  version: string
  author: string
  homepage: string
  rawScript: string
}

export interface InitedSources {
  [source: string]: { type: 'music'; actions: SourceAction[]; qualitys: Quality[] }
}

export interface LyricInfo {
  lyric: string
  tlyric: string | null
  rlyric: string | null
  lxlyric: string | null
}

export interface LxEnvHooks {
  onInited(sources: InitedSources): void
  onUpdateAlert(data: { log: string; updateUrl?: string }): void
  onError(message: string): void
}

export interface RequestHandler {
  (params: { source: string; action: SourceAction; info: unknown }): Promise<unknown>
}

/** preload.js 同款歌词校验 */
export function verifyLyricInfo(info: unknown): LyricInfo {
  const i = info as Record<string, unknown>
  if (typeof info !== 'object' || info === null || typeof i.lyric !== 'string') throw new Error('failed')
  if ((i.lyric as string).length > 51200) throw new Error('failed')
  return {
    lyric: i.lyric as string,
    tlyric: typeof i.tlyric === 'string' && i.tlyric.length < 5120 ? i.tlyric : null,
    rlyric: typeof i.rlyric === 'string' && i.rlyric.length < 5120 ? i.rlyric : null,
    lxlyric: typeof i.lxlyric === 'string' && i.lxlyric.length < 8192 ? i.lxlyric : null,
  }
}

/** preload.js 同款 URL 校验 */
export function verifyUrl(response: unknown): string {
  if (typeof response !== 'string' || response.length > 2048 || !/^https?:/.test(response)) throw new Error('failed')
  return response
}

export class LxEnv {
  readonly scriptInfo: ScriptInfo
  private readonly hooks: LxEnvHooks
  private isInited = false
  private isShowedUpdateAlert = false
  private requestHandler: RequestHandler | null = null

  constructor(scriptInfo: ScriptInfo, hooks: LxEnvHooks) {
    this.scriptInfo = scriptInfo
    this.hooks = hooks
  }

  /** 构造暴露给音源脚本的 globalThis.lx 对象 */
  buildGlobal(): Record<string, unknown> {
    return {
      EVENT_NAMES,
      request: this.lxRequest,
      send: this.send,
      on: this.on,
      utils: {
        crypto: {
          aesEncrypt(buffer: Buffer, mode: string, key: Buffer | string, iv: Buffer | string) {
            const cipher = createCipheriv(mode, key, iv)
            return Buffer.concat([cipher.update(buffer), cipher.final()])
          },
          rsaEncrypt(buffer: Buffer, key: string) {
            buffer = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer])
            return publicEncrypt({ key, padding: constants.RSA_NO_PADDING }, buffer)
          },
          randomBytes(size: number) {
            return randomBytes(size)
          },
          md5(str: string) {
            return createHash('md5').update(str).digest('hex')
          },
        },
        buffer: {
          from(...args: Parameters<typeof Buffer.from>) {
            return Buffer.from(...args)
          },
          bufToString(buf: Parameters<typeof Buffer.from>[0], format: BufferEncoding) {
            return Buffer.from(buf as never, 'binary').toString(format)
          },
        },
        zlib: {
          inflate(buf: Buffer) {
            return new Promise((resolve, reject) => {
              zlib.inflate(buf, (err, data) => (err ? reject(new Error(err.message)) : resolve(data)))
            })
          },
          deflate(data: zlib.InputType) {
            return new Promise((resolve, reject) => {
              zlib.deflate(data, (err, buf) => (err ? reject(new Error(err.message)) : resolve(buf)))
            })
          },
        },
      },
      currentScriptInfo: { ...this.scriptInfo },
      version: '2.0.0',
      env: 'desktop',
    }
  }

  /** lx.request — needle 封装，与 preload.js 行为一致 */
  private lxRequest = (
    url: string,
    options: {
      method?: string
      timeout?: number
      headers?: Record<string, string>
      body?: unknown
      form?: unknown
      formData?: unknown
    },
    callback: (err: Error | null, resp: unknown, body: unknown) => void,
  ): (() => void) => {
    const { method = 'get', timeout, headers, body, form, formData } = options ?? {}
    const needleOptions: Record<string, unknown> = { headers }
    let data: unknown = null
    if (body) {
      data = body
    } else if (form) {
      data = form
      needleOptions.json = false
    } else if (formData) {
      data = formData
      needleOptions.json = false
    }
    needleOptions.response_timeout = typeof timeout === 'number' && timeout > 0 ? Math.min(timeout, 60_000) : 60_000

    if (process.env.RO_PROBE_HTTP) console.log(`[lxRequest] ${method.toUpperCase()} ${url}`)

    let request = (needle.request(method as 'get', url, data as never, needleOptions as never, (err, resp) => {
      try {
        if (err) {
          callback(err, null, null)
        } else {
          let respBody: unknown = resp.raw.toString()
          try {
            respBody = JSON.parse(respBody as string)
          } catch {
            /* keep string */
          }
          callback(
            err,
            {
              statusCode: resp.statusCode,
              statusMessage: resp.statusMessage,
              headers: resp.headers,
              bytes: resp.bytes,
              raw: resp.raw,
              body: respBody,
            },
            respBody,
          )
        }
      } catch (e) {
        this.hooks.onError((e as Error).message)
      }
    }) as unknown as { request: { aborted?: boolean; abort: () => void } }).request as { aborted?: boolean; abort: () => void } | null

    return () => {
      if (request && !request.aborted) request.abort()
      request = null
    }
  }

  private send = (eventName: string, data: unknown): Promise<void> => {
    return new Promise((resolve, reject) => {
      switch (eventName) {
        case EVENT_NAMES.inited: {
          if (this.isInited) return reject(new Error('Script is inited'))
          this.isInited = true
          this.handleInit(data as { openDevTools?: boolean; sources?: Record<string, { type?: string; actions?: string[]; qualitys?: string[] }> } | null)
          resolve()
          break
        }
        case EVENT_NAMES.updateAlert: {
          if (this.isShowedUpdateAlert) return reject(new Error('The update alert can only be called once.'))
          this.isShowedUpdateAlert = true
          this.handleUpdateAlert(data as { log?: unknown; updateUrl?: string }, resolve, reject)
          break
        }
        default:
          reject(new Error('The event is not supported: ' + eventName))
      }
    })
  }

  private on = (eventName: string, handler: RequestHandler): Promise<void> => {
    if (eventName !== EVENT_NAMES.request) return Promise.reject(new Error('The event is not supported: ' + eventName))
    this.requestHandler = handler
    return Promise.resolve()
  }

  private handleInit(info: { sources?: Record<string, { type?: string; actions?: string[]; qualitys?: string[] }> } | null): void {
    if (!info) {
      this.hooks.onError('Missing required parameter init info')
      return
    }
    const sources: InitedSources = {}
    try {
      for (const source of ALL_SOURCES) {
        const userSource = info.sources?.[source]
        if (!userSource || userSource.type !== 'music') continue
        const qualitys = SUPPORT_QUALITYS[source] ?? []
        const actions = SUPPORT_ACTIONS[source] ?? []
        sources[source] = {
          type: 'music',
          actions: actions.filter((a) => userSource.actions?.includes(a)),
          qualitys: qualitys.filter((q) => userSource.qualitys?.includes(q)),
        }
      }
    } catch (error) {
      this.hooks.onError((error as Error).message)
      return
    }
    this.hooks.onInited(sources)
  }

  private handleUpdateAlert(
    data: { log?: unknown; updateUrl?: string },
    resolve: () => void,
    reject: (e: Error) => void,
  ): void {
    if (!data || typeof data !== 'object') return reject(new Error('parameter format error.'))
    if (!data.log || typeof data.log !== 'string') return reject(new Error('log is required.'))
    let log = data.log
    let updateUrl = data.updateUrl
    if (updateUrl && !/^https?:\/\/[^\s$.?#].[^\s]*$/.test(updateUrl) && updateUrl.length > 1024) updateUrl = undefined
    if (log.length > 1024) log = log.substring(0, 1024) + '...'
    this.hooks.onUpdateAlert({ log, updateUrl })
    resolve()
  }

  /** 调用音源脚本注册的 request handler（musicUrl / lyric / pic） */
  async callAction(source: string, action: SourceAction, info: unknown): Promise<unknown> {
    if (!this.requestHandler) throw new Error('Request event is not defined')
    const response = await this.requestHandler({ source, action, info })
    switch (action) {
      case 'musicUrl':
        return verifyUrl(response)
      case 'lyric':
        return verifyLyricInfo(response)
      case 'pic':
        return verifyUrl(response)
      default:
        throw new Error('Unknown action: ' + String(action))
    }
  }
}
