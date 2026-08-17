/**
 * 下载 + 任务路由
 *   POST   /api/v1/download        提交下载任务
 *   GET    /api/v1/tasks           任务列表（可 ?status=）
 *   GET    /api/v1/tasks/:id       单任务详情
 *   POST   /api/v1/tasks/:id/retry 重试
 *   POST   /api/v1/tasks/:id/cancel 取消
 *   DELETE /api/v1/tasks/:id       删除记录
 */
import type { FastifyInstance } from 'fastify'
import { downloadQueue } from '../core/download/queue.js'
import { isPlatform, ALL_PLATFORMS } from '../core/search/index.js'
import type { MusicInfo } from '../core/adapters/common.js'
import type { Quality } from '../core/source-engine/lx-env.js'
import type { TaskStatus } from '../core/db/index.js'

const VALID_QUALITIES: Quality[] = ['flac24bit', 'flac', '320k', '128k']

interface DownloadBody {
  platform?: string
  musicInfo?: MusicInfo
  quality?: Quality
  primarySourceId?: string
  sourceIds?: string[]
}

interface BatchDownloadBody {
  quality?: Quality
  primarySourceId?: string
  sourceIds?: string[]
  items?: { platform?: string; musicInfo?: MusicInfo; quality?: Quality }[]
}

export async function downloadRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: DownloadBody }>('/api/v1/download', async (req, reply) => {
    const { platform, musicInfo, quality = 'flac', primarySourceId, sourceIds } = req.body ?? {}
    if (!platform || !isPlatform(platform)) return reply.code(400).send({ error: 'invalid platform', valid: ALL_PLATFORMS })
    if (!musicInfo || !musicInfo.songmid || !musicInfo.name) return reply.code(400).send({ error: 'musicInfo (with songmid & name) is required' })
    if (!VALID_QUALITIES.includes(quality)) return reply.code(400).send({ error: 'invalid quality', valid: VALID_QUALITIES })
    const id = downloadQueue.enqueue({ platform, musicInfo, quality, primarySourceId, sourceIds })
    return reply.code(201).send({ id, status: 'pending' })
  })

  // 批量下载：一次提交多首（前端复选框勾选后调用）
  app.post<{ Body: BatchDownloadBody }>('/api/v1/download/batch', async (req, reply) => {
    const { items, quality: defaultQuality = 'flac', primarySourceId, sourceIds } = req.body ?? {}
    if (!Array.isArray(items) || items.length === 0) return reply.code(400).send({ error: 'items (non-empty array) is required' })
    if (items.length > 200) return reply.code(400).send({ error: 'too many items (max 200)' })

    const accepted: { index: number; id: string; name?: string }[] = []
    const rejected: { index: number; error: string }[] = []
    items.forEach((item, index) => {
      const platform = item.platform
      const musicInfo = item.musicInfo
      const quality = item.quality ?? defaultQuality
      if (!platform || !isPlatform(platform)) return void rejected.push({ index, error: 'invalid platform' })
      if (!musicInfo || !musicInfo.songmid || !musicInfo.name) return void rejected.push({ index, error: 'musicInfo (with songmid & name) is required' })
      if (!VALID_QUALITIES.includes(quality)) return void rejected.push({ index, error: 'invalid quality' })
      const id = downloadQueue.enqueue({ platform, musicInfo, quality, primarySourceId, sourceIds })
      accepted.push({ index, id, name: musicInfo.name })
    })
    return reply.code(201).send({ acceptedCount: accepted.length, rejectedCount: rejected.length, accepted, rejected })
  })

  app.get<{ Querystring: { status?: string } }>('/api/v1/tasks', async (req) => {
    const status = req.query.status as TaskStatus | undefined
    return { tasks: downloadQueue.list(status) }
  })

  app.get<{ Params: { id: string } }>('/api/v1/tasks/:id', async (req, reply) => {
    const t = downloadQueue.get(req.params.id)
    if (!t) return reply.code(404).send({ error: 'task not found' })
    return t
  })

  app.post<{ Params: { id: string } }>('/api/v1/tasks/:id/retry', async (req, reply) => {
    const ok = downloadQueue.retry(req.params.id)
    if (!ok) return reply.code(409).send({ error: 'task not retryable' })
    return { id: req.params.id, status: 'pending' }
  })

  app.post<{ Params: { id: string } }>('/api/v1/tasks/:id/cancel', async (req, reply) => {
    const ok = downloadQueue.cancel(req.params.id)
    if (!ok) return reply.code(409).send({ error: 'task not cancelable' })
    return { id: req.params.id, status: 'canceled' }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/tasks/:id', async (req, reply) => {
    const ok = downloadQueue.remove(req.params.id)
    if (!ok) return reply.code(404).send({ error: 'task not found' })
    return { id: req.params.id, deleted: true }
  })
}
