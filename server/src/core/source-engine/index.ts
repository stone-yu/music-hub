/**
 * 音源引擎 — 加载/管理 data/sources/*.js 音源脚本
 *
 * - 每个音源脚本一个 worker 沙箱（sandbox-worker.ts）
 * - 解析脚本头部注释元信息（@name/@description/@version/@author/@homepage）
 * - inited 后记录各平台支持的 actions/qualitys
 * - musicUrl 按音质降级链调用：flac24bit → flac → 320k → 128k
 * - chokidar 式热重载（fs.watch 简化实现，去抖 500ms）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { EventEmitter } from 'node:events'
import { config } from '../config.js'
import { logger } from '../logger.js'
import type { InitedSources, LyricInfo, Quality, ScriptInfo, SourceAction } from './lx-env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const QUALITY_FALLBACK: Quality[] = ['flac24bit', 'flac', '320k', '128k']

interface PendingCall {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export interface LoadedSource {
  id: string // 文件名（不含扩展名）
  file: string
  info: Omit<ScriptInfo, 'rawScript'>
  sources: InitedSources
  enabled: boolean
  status: 'loading' | 'ready' | 'error'
  errorMessage?: string
}

interface WorkerBox {
  worker: Worker
  calls: Map<number, PendingCall>
  nextId: number
}

/** 解析音源脚本头部 @field 注释 */
export function parseScriptMeta(script: string, fallbackName: string): Omit<ScriptInfo, 'rawScript'> {
  const head = script.slice(0, 2048)
  const pick = (field: string): string => {
    const m = head.match(new RegExp(`@${field}\\s+(.+)`))
    return m ? m[1].trim() : ''
  }
  return {
    name: pick('name') || fallbackName,
    description: pick('description'),
    version: pick('version'),
    author: pick('author'),
    homepage: pick('homepage'),
  }
}

export class SourceEngine extends EventEmitter {
  private sources = new Map<string, LoadedSource>()
  private workers = new Map<string, WorkerBox>()
  private reloadTimer: NodeJS.Timeout | null = null
  private watcher: fs.FSWatcher | null = null

  async start(): Promise<void> {
    await this.loadAll()
    if (config.sources.hotReload) this.watch()
  }

  async stop(): Promise<void> {
    this.watcher?.close()
    for (const id of [...this.workers.keys()]) await this.unload(id)
  }

  list(): LoadedSource[] {
    return [...this.sources.values()]
  }

  get(id: string): LoadedSource | undefined {
    return this.sources.get(id)
  }

  setEnabled(id: string, enabled: boolean): void {
    const s = this.sources.get(id)
    if (!s) throw new Error(`source not found: ${id}`)
    s.enabled = enabled
    this.emit('source:changed', this.list())
  }

  /** 目标文件名（清洗后，落在 sources 目录），已确保 .js 后缀 */
  private sourceFilePath(name: string): string {
    const base = name.replace(/[^\w.-]/g, '_').replace(/\.js$/i, '') || `source-${Date.now()}`
    return path.join(config.sources.dir, `${base}.js`)
  }

  /**
   * 从脚本内容导入音源（本地上传/粘贴）。写入 sources 目录并立即加载。
   * name 用作文件名（音源 id）。返回加载后的音源记录。
   */
  async importFromContent(name: string, content: string): Promise<LoadedSource> {
    if (!content || content.length < 10) throw new Error('音源脚本内容为空或过短')
    fs.mkdirSync(config.sources.dir, { recursive: true })
    const file = this.sourceFilePath(name)
    // 关掉热重载导致的重复加载：直接写文件后手动 load
    fs.writeFileSync(file, content, 'utf8')
    await this.load(file)
    const rec = this.sources.get(path.basename(file, '.js'))
    if (!rec) throw new Error('音源加载失败')
    if (rec.status === 'error') throw new Error(`音源加载失败: ${rec.errorMessage ?? 'unknown'}`)
    return rec
  }

  /**
   * 从在线 URL 导入音源。拉取脚本文本后走 importFromContent。
   * needle 动态引入，避免顶层耦合。
   */
  async importFromUrl(url: string, name?: string): Promise<LoadedSource> {
    if (!/^https?:\/\//.test(url)) throw new Error('URL 必须以 http(s):// 开头')
    const needle = (await import('needle')).default
    const resp = await needle('get', url, { follow_max: 5, response_timeout: 20_000, parse_response: false })
    const body = Buffer.isBuffer(resp.body) ? resp.body.toString('utf8') : String(resp.body)
    if (!body || (resp.statusCode ?? 0) >= 400) throw new Error(`拉取音源失败: HTTP ${resp.statusCode}`)
    // 文件名：优先用参数，其次从 URL 末段推断
    const inferred = name || decodeURIComponent(url.split('?')[0]!.split('/').pop() || '') || `source-${Date.now()}`
    return this.importFromContent(inferred, body)
  }

  /** 删除音源（卸载 worker + 删文件） */
  async remove(id: string): Promise<void> {
    const rec = this.sources.get(id)
    const file = rec?.file
    await this.unload(id)
    if (file && fs.existsSync(file)) fs.rmSync(file, { force: true })
    this.emit('source:changed', this.list())
  }

  async loadAll(): Promise<void> {
    const dir = config.sources.dir
    fs.mkdirSync(dir, { recursive: true })
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
    for (const f of files) await this.load(path.join(dir, f))
    logger.info({ count: this.sources.size }, 'source engine: all sources loaded')
  }

  async load(file: string): Promise<void> {
    const id = path.basename(file, '.js')
    await this.unload(id)

    const rawScript = fs.readFileSync(file, 'utf8')
    const meta = parseScriptMeta(rawScript, id)
    const record: LoadedSource = {
      id,
      file,
      info: meta,
      sources: {},
      enabled: true,
      status: 'loading',
    }
    this.sources.set(id, record)

    const scriptInfo: ScriptInfo = { ...meta, rawScript }
    const worker = new Worker(path.join(__dirname, 'sandbox-worker.js'), {
      workerData: { scriptInfo },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    })
    const box: WorkerBox = { worker, calls: new Map(), nextId: 1 }
    this.workers.set(id, box)

    // 等待首次 inited/error，让 load() 直到音源真正 ready 才 resolve
    let settle: (() => void) | null = null
    const readyPromise = new Promise<void>((resolve) => { settle = resolve })
    const readyTimer = setTimeout(() => { settle?.(); settle = null }, 15_000)

    worker.on('message', (msg: { type: string; [k: string]: unknown }) => {
      switch (msg.type) {
        case 'inited':
          record.sources = msg.sources as InitedSources
          record.status = 'ready'
          logger.info({ source: id, platforms: Object.keys(record.sources) }, 'source inited')
          this.emit('source:changed', this.list())
          clearTimeout(readyTimer); settle?.(); settle = null
          break
        case 'update-alert':
          logger.warn({ source: id, data: msg.data }, 'source update alert')
          this.emit('source:update-alert', { id, ...(msg.data as object) })
          break
        case 'error':
          record.status = 'error'
          record.errorMessage = String(msg.message)
          logger.error({ source: id, message: msg.message }, 'source error')
          this.emit('source:changed', this.list())
          clearTimeout(readyTimer); settle?.(); settle = null
          break
        case 'action-result': {
          const call = box.calls.get(msg.id as number)
          if (!call) return
          box.calls.delete(msg.id as number)
          clearTimeout(call.timer)
          if (msg.ok) call.resolve(msg.result)
          else call.reject(new Error(String(msg.message)))
          break
        }
        case 'log':
          logger.debug({ source: id, args: msg.args }, 'source console')
          break
      }
    })

    worker.on('error', (err) => {
      record.status = 'error'
      record.errorMessage = err.message
      logger.error({ source: id, err }, 'source worker crashed')
      clearTimeout(readyTimer); settle?.(); settle = null
    })

    await readyPromise
  }

  async unload(id: string): Promise<void> {
    const box = this.workers.get(id)
    if (box) {
      for (const call of box.calls.values()) {
        clearTimeout(call.timer)
        call.reject(new Error('source unloaded'))
      }
      await box.worker.terminate()
      this.workers.delete(id)
    }
    this.sources.delete(id)
  }

  private watch(): void {
    this.watcher = fs.watch(config.sources.dir, () => {
      if (this.reloadTimer) clearTimeout(this.reloadTimer)
      this.reloadTimer = setTimeout(() => {
        logger.info('source dir changed, reloading all sources')
        void this.loadAll()
      }, 500)
    })
  }

  /** 底层 action 调用 */
  private callAction(sourceId: string, platform: string, action: SourceAction, info: unknown, timeoutMs = 30_000): Promise<unknown> {
    const box = this.workers.get(sourceId)
    const record = this.sources.get(sourceId)
    if (!box || !record) return Promise.reject(new Error(`source not loaded: ${sourceId}`))
    if (!record.enabled) return Promise.reject(new Error(`source disabled: ${sourceId}`))
    if (record.status !== 'ready') return Promise.reject(new Error(`source not ready: ${sourceId} (${record.status})`))

    const id = box.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        box.calls.delete(id)
        reject(new Error(`action timeout: ${sourceId}/${platform}/${action}`))
      }, timeoutMs)
      box.calls.set(id, { resolve, reject, timer })
      box.worker.postMessage({ type: 'call-action', id, source: platform, action, info })
    })
  }

  /**
   * 获取播放/下载 URL，带音质降级链。
   * musicInfo 为搜索适配器产出的歌曲对象（各平台结构不同，原样透传给音源脚本）
   */
  async getMusicUrl(
    sourceId: string,
    platform: string,
    musicInfo: unknown,
    quality: Quality,
  ): Promise<{ url: string; quality: Quality }> {
    const record = this.sources.get(sourceId)
    if (!record) throw new Error(`source not loaded: ${sourceId}`)
    const supported = record.sources[platform]?.qualitys ?? []

    const start = QUALITY_FALLBACK.indexOf(quality)
    const chain = QUALITY_FALLBACK.slice(start === -1 ? 0 : start).filter((q) => supported.includes(q))
    if (chain.length === 0) throw new Error(`no supported quality for ${platform} (want ${quality})`)

    let lastError: Error | null = null
    for (const q of chain) {
      try {
        const url = (await this.callAction(sourceId, platform, 'musicUrl', {
          musicInfo,
          type: q,
        })) as string
        return { url, quality: q }
      } catch (err) {
        lastError = err as Error
        logger.warn({ sourceId, platform, quality: q, err: lastError.message }, 'musicUrl failed, trying next quality')
      }
    }
    throw lastError ?? new Error('all qualities failed')
  }

  /**
   * 精确取指定音质的 URL（不做任何降级）。
   * 供编排器做「跨音源同音质横向遍历」时使用，降级次序由编排器统一掌控。
   */
  async getMusicUrlExact(
    sourceId: string,
    platform: string,
    musicInfo: unknown,
    quality: Quality,
  ): Promise<string> {
    const record = this.sources.get(sourceId)
    if (!record) throw new Error(`source not loaded: ${sourceId}`)
    const supported = record.sources[platform]?.qualitys ?? []
    if (!supported.includes(quality)) throw new Error(`${sourceId} 不支持 ${platform} 的 ${quality} 音质`)
    return (await this.callAction(sourceId, platform, 'musicUrl', { musicInfo, type: quality })) as string
  }

  async getLyric(sourceId: string, platform: string, musicInfo: unknown): Promise<LyricInfo> {
    return (await this.callAction(sourceId, platform, 'lyric', { musicInfo })) as LyricInfo
  }

  async getPic(sourceId: string, platform: string, musicInfo: unknown): Promise<string> {
    return (await this.callAction(sourceId, platform, 'pic', { musicInfo })) as string
  }
}

export const sourceEngine = new SourceEngine()
