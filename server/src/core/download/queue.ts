/**
 * 下载任务队列 — SQLite 持久化 + p-queue 内存调度（并发默认 3）
 *
 * 生命周期：pending → active → completed / completed_with_warnings / failed
 * 重启时把中断的 active 重新入队（requeueInterrupted）。
 */
import PQueue from 'p-queue'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { taskStore, initDb, type DownloadTaskRow, type TaskStatus } from '../db/index.js'
import { orchestrator } from '../orchestrator/index.js'
import { downloader } from './index.js'
import { fetchLyric, fetchCoverUrl } from '../adapters/metadata.js'
import { config } from '../config.js'
import { logger } from '../logger.js'
import type { MusicInfo } from '../adapters/common.js'
import type { Quality } from '../source-engine/lx-env.js'

export interface EnqueueInput {
  platform: string
  musicInfo: MusicInfo
  quality: Quality
  primarySourceId?: string
  sourceIds?: string[]
}

function toTaskView(row: DownloadTaskRow) {
  return {
    id: row.id,
    platform: row.platform,
    songmid: row.songmid,
    name: row.name,
    singer: row.singer,
    album: row.album,
    requestedQuality: row.requested_quality,
    actualQuality: row.actual_quality,
    actualSource: row.actual_source,
    status: row.status,
    progress: row.progress,
    filePath: row.file_path,
    fileSize: row.file_size,
    warnings: row.warnings ? (JSON.parse(row.warnings) as string[]) : [],
    error: row.error,
    scrape_status: null as string | null, // 路由层从 scrape_tasks 表填充
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

class DownloadQueue extends EventEmitter {
  private queue = new PQueue({ concurrency: config.download.concurrency })

  setConcurrency(n: number): void {
    this.queue.concurrency = n
  }

  init(): void {
    initDb()
    const requeued = taskStore.requeueInterrupted()
    if (requeued > 0) logger.warn(`[queue] requeued ${requeued} interrupted task(s)`)
    // 重启续跑：把所有 pending 重新塞进内存队列
    for (const row of taskStore.list({ status: 'pending', limit: 1000 })) {
      this.schedule(row.id)
    }
  }

  enqueue(input: EnqueueInput): string {
    const id = randomUUID()
    const now = Date.now()
    const row: DownloadTaskRow = {
      id,
      keyword_source: input.platform,
      platform: input.platform,
      songmid: String(input.musicInfo.songmid),
      name: input.musicInfo.name,
      singer: input.musicInfo.singer,
      album: input.musicInfo.albumName ?? '',
      requested_quality: input.quality,
      actual_quality: null,
      actual_source: null,
      music_info: JSON.stringify({
        ...input,
      }),
      status: 'pending',
      progress: 0,
      file_path: null,
      file_size: null,
      warnings: null,
      error: null,
      created_at: now,
      updated_at: now,
    }
    taskStore.insert(row)
    this.emit('task:created', toTaskView(row))
    this.schedule(id)
    return id
  }

  private schedule(id: string): void {
    void this.queue.add(() => this.run(id))
  }

  private setStatus(id: string, status: TaskStatus, patch: Partial<DownloadTaskRow> = {}): void {
    taskStore.update(id, { status, ...patch })
    const row = taskStore.get(id)
    if (row) this.emit(`task:${status}`, toTaskView(row))
  }

  private async run(id: string): Promise<void> {
    const row = taskStore.get(id)
    if (!row || row.status === 'canceled') return
    const input = JSON.parse(row.music_info) as EnqueueInput

    this.setStatus(id, 'active', { progress: 0 })
    this.emit('task:active', toTaskView(taskStore.get(id)!))

    try {
      // 1) 编排器跨音源取 URL（同音质横向找遍 → 降级）
      const { result, attempts } = await orchestrator.resolveUrl({
        platform: input.platform,
        musicInfo: input.musicInfo,
        quality: input.quality,
        primarySourceId: input.primarySourceId,
        sourceIds: input.sourceIds,
      })
      logger.info({ id, attempts, toggled: result.toggled, actualPlatform: result.platform }, '[queue] url resolved')

      // 换源后：歌词/封面/标签都用实际命中的平台与歌曲对象（洛雪 toggleSource 行为）
      const effPlatform = result.platform
      const effMusicInfo = result.musicInfo as MusicInfo

      // 2) 歌词 + 封面（best-effort，走平台官方接口，洛雪逻辑：不走音源）
      const [lyricRes, coverUrl] = await Promise.all([
        fetchLyric(effPlatform, effMusicInfo),
        fetchCoverUrl(effPlatform, effMusicInfo),
      ])
      const lyric = lyricRes?.lyric ?? null

      // 3) 下载 + 元数据（标题/歌手/专辑仍用原曲信息，保持用户搜索预期；封面/歌词用实际命中源）
      const outcome = await downloader.download(
        result.url,
        result.quality,
        {
          name: input.musicInfo.name,
          singer: input.musicInfo.singer,
          album: input.musicInfo.albumName,
          coverUrl,
          lyric,
        },
        input.musicInfo,
        (received, total, percent) => {
          taskStore.update(id, { progress: percent })
          this.emit('task:progress', { id, received, total, percent })
        },
      )

      // 换源提示先入 warnings，再判定最终状态（换源本身即视为 with_warnings）
      if (result.toggled) outcome.warnings.push(`跨平台换源：${input.platform} → ${result.platform}（原平台取 URL 失败，自动换到同款歌曲）`)
      const finalStatus: TaskStatus = outcome.warnings.length ? 'completed_with_warnings' : 'completed'

      this.setStatus(id, finalStatus, {
        progress: 100,
        actual_quality: result.quality,
        actual_source: result.toggled ? `${result.sourceId}@${result.platform}` : result.sourceId,
        file_path: outcome.filePath,
        file_size: outcome.fileSize,
        warnings: outcome.warnings.length ? JSON.stringify(outcome.warnings) : null,
      })
      logger.info({ id, status: finalStatus, file: outcome.filePath, quality: result.quality, source: result.sourceId }, '[queue] done')
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.setStatus(id, 'failed', { error })
      logger.error({ id, error }, '[queue] failed')
    }
  }

  cancel(id: string): boolean {
    const row = taskStore.get(id)
    if (!row) return false
    if (row.status === 'pending' || row.status === 'active') {
      this.setStatus(id, 'canceled')
      return true
    }
    return false
  }

  retry(id: string): boolean {
    const row = taskStore.get(id)
    if (!row) return false
    if (row.status === 'failed' || row.status === 'canceled' || row.status === 'completed_with_warnings') {
      taskStore.update(id, { status: 'pending', progress: 0, error: null, warnings: null })
      this.schedule(id)
      return true
    }
    return false
  }

  list(status?: TaskStatus) {
    return taskStore.list({ status, limit: 200 }).map(toTaskView)
  }

  get(id: string) {
    const row = taskStore.get(id)
    return row ? toTaskView(row) : undefined
  }

  remove(id: string): boolean {
    const row = taskStore.get(id)
    if (!row) return false
    taskStore.delete(id)
    return true
  }

  stats() {
    return { pending: this.queue.pending, active: this.queue.size > 0 ? this.queue.pending : 0 }
  }
}

export const downloadQueue = new DownloadQueue()
