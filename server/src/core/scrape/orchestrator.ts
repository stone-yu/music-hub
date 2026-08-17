/**
 * 刮削编排器 — 监听下载完成事件，自动整理文件入库 + 触发 Navidrome 扫描。
 *
 * 接入点：events.ts wireEvents() 调 attachToDownloadQueue(downloadQueue)，
 * 监听 task:completed 和 task:completed_with_warnings（两个独立事件）。
 *
 * 流程：organizeFile 移动到 {targetDir}/{artist}/{album}/ → startScanAndWait → library.refresh
 * 状态机：pending→organizing→organized→scanning→done（失败→failed）
 */
import { EventEmitter } from 'node:events'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { emitEvent } from '../events.js'
import { scrapeStore, type ScrapeTaskRow, type ScrapeStatus } from '../db/scrape.js'
import { taskStore } from '../db/index.js'
import { organizeFile } from './organize.js'
import { navidromeClient } from '../navidrome/client.js'
import { library } from '../library/cache.js'

interface CompletedPayload {
  id: string
  filePath: string | null
  name: string
  singer: string
  album: string
  actualQuality?: string | null
}

class ScrapeOrchestrator extends EventEmitter {
  /** 由 events.ts wireEvents() 启动时调用一次 */
  attachToDownloadQueue(downloadQueue: EventEmitter): void {
    for (const evt of ['task:completed', 'task:completed_with_warnings'] as const) {
      downloadQueue.on(evt, (payload: CompletedPayload) => {
        if (!config.scrape.enabled || !config.scrape.autoOnDownload) return
        if (!payload.filePath) return
        // 同一下载任务不重复入队
        if (payload.id && scrapeStore.findByDownloadTask(payload.id)) {
          logger.debug({ downloadTaskId: payload.id }, '[scrape] already enqueued, skip')
          return
        }
        void this.enqueue({
          downloadTaskId: payload.id,
          filePath: payload.filePath,
          name: payload.name,
          singer: payload.singer,
          album: payload.album,
        }).catch((err) => logger.error({ err: (err as Error).message }, '[scrape] enqueue failed'))
      })
    }
  }

  async enqueue(input: {
    downloadTaskId: string | null
    filePath: string
    name: string
    singer: string
    album: string
  }): Promise<string> {
    const id = scrapeStore.createId()
    const row: ScrapeTaskRow = {
      id,
      download_task_id: input.downloadTaskId,
      file_path: input.filePath,
      name: input.name,
      singer: input.singer,
      album: input.album ?? '',
      target_dir: config.scrape.targetDir,
      target_path: null,
      status: 'pending',
      error: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    scrapeStore.insert(row)
    emitEvent('scrape:started', { id, downloadTaskId: input.downloadTaskId, name: input.name })
    void this.run(id)
    return id
  }

  /** 手动触发：对一个已完成的下载任务做刮削 */
  async enqueueByDownloadTask(downloadTaskId: string): Promise<string | null> {
    const task = taskStore.get(downloadTaskId)
    if (!task) return null
    if (!task.file_path) return null
    if (scrapeStore.findByDownloadTask(downloadTaskId)) {
      logger.info({ downloadTaskId }, '[scrape] already scraped, skip')
      return null
    }
    return this.enqueue({
      downloadTaskId,
      filePath: task.file_path,
      name: task.name,
      singer: task.singer,
      album: task.album,
    })
  }

  private async run(id: string): Promise<void> {
    const row = scrapeStore.get(id)
    if (!row) return
    try {
      // 阶段1：整理移动
      scrapeStore.update(id, { status: 'organizing' })
      const { targetPath } = await organizeFile(row.file_path, row.name, row.singer, row.album, row.target_dir)
      scrapeStore.update(id, { status: 'organized', target_path: targetPath })
      emitEvent('scrape:organized', { id, targetPath })
      logger.info({ id, targetPath }, '[scrape] file organized')

      // 阶段2：触发 Navidrome 扫描 + 等待完成
      scrapeStore.update(id, { status: 'scanning' })
      await navidromeClient.startScanAndWait(120_000, 3_000)

      // 扫描后刷新曲库缓存（让新入库歌曲即时可见）
      library.refresh(false)
      scrapeStore.update(id, { status: 'done' })
      emitEvent('scrape:done', { id })
      logger.info({ id }, '[scrape] done')
    } catch (err) {
      const error = (err as Error).message
      scrapeStore.update(id, { status: 'failed', error })
      emitEvent('scrape:failed', { id, error })
      logger.error({ id, error }, '[scrape] run failed')
    }
  }

  list(status?: ScrapeStatus) {
    return scrapeStore.list({ status, limit: 200 })
  }

  get(id: string) {
    return scrapeStore.get(id)
  }
}

export const scrapeOrchestrator = new ScrapeOrchestrator()
