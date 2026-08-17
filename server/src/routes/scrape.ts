/**
 * 刮削路由
 *   GET  /api/v1/scrape/tasks?status=             刮削任务列表
 *   GET  /api/v1/scrape/tasks/:id                 单任务详情
 *   POST /api/v1/scrape/tasks/:downloadTaskId     手动对某下载任务触发刮削
 *   POST /api/v1/scrape/scan                      手动触发 Navidrome 扫描
 *   POST /api/v1/scrape/organize                  仅整理不扫描（调试）
 */
import type { FastifyInstance } from 'fastify'
import { scrapeOrchestrator } from '../core/scrape/orchestrator.js'
import { organizeFile } from '../core/scrape/organize.js'
import { navidromeClient } from '../core/navidrome/client.js'
import { library } from '../core/library/cache.js'
import { config } from '../core/config.js'
import type { ScrapeStatus } from '../core/db/scrape.js'

interface TasksQuery {
  status?: string
}

interface OrganizeBody {
  filePath?: string
  name?: string
  singer?: string
  album?: string
}

const VALID_STATUS: ScrapeStatus[] = ['pending', 'organizing', 'organized', 'scanning', 'done', 'failed', 'skipped']

export async function scrapeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: TasksQuery }>('/api/v1/scrape/tasks', async (req) => {
    const { status } = req.query
    const filter = status && VALID_STATUS.includes(status as ScrapeStatus) ? (status as ScrapeStatus) : undefined
    return { tasks: scrapeOrchestrator.list(filter) }
  })

  app.get<{ Params: { id: string } }>('/api/v1/scrape/tasks/:id', async (req, reply) => {
    const task = scrapeOrchestrator.get(req.params.id)
    if (!task) return reply.code(404).send({ error: 'scrape task not found' })
    return task
  })

  app.post<{ Params: { downloadTaskId: string } }>('/api/v1/scrape/tasks/:downloadTaskId', async (req, reply) => {
    const id = await scrapeOrchestrator.enqueueByDownloadTask(req.params.downloadTaskId)
    if (!id) return reply.code(400).send({ error: '下载任务不存在、无文件或已刮削' })
    return { status: 'ok', scrapeTaskId: id }
  })

  app.post('/api/v1/scrape/scan', async () => {
    library.refresh(false)
    void navidromeClient.startScanAndWait(120_000, 3_000).then(() => library.refresh(false))
    return { status: 'ok', scanning: true }
  })

  app.post<{ Body: OrganizeBody }>('/api/v1/scrape/organize', async (req, reply) => {
    const { filePath, name, singer, album } = req.body ?? {}
    if (!filePath?.trim() || !name?.trim()) return reply.code(400).send({ error: 'filePath 和 name 必填' })
    try {
      const { targetPath } = await organizeFile(filePath.trim(), name.trim(), singer ?? '', album ?? '', config.scrape.targetDir)
      return { status: 'ok', targetPath }
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message })
    }
  })
}
