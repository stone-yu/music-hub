/**
 * 音源管理路由
 *   GET    /api/v1/sources                列表（含状态/平台/音质）
 *   POST   /api/v1/sources/import/content  粘贴/上传脚本内容导入 { name, content }
 *   POST   /api/v1/sources/import/url      在线 URL 导入 { url, name? }
 *   POST   /api/v1/sources/upload          multipart 文件上传
 *   PATCH  /api/v1/sources/:id/enabled     启停 { enabled }
 *   POST   /api/v1/sources/:id/reload      热重载单个音源
 *   DELETE /api/v1/sources/:id             删除
 */
import type { FastifyInstance } from 'fastify'
import { sourceEngine, type LoadedSource } from '../core/source-engine/index.js'

function view(s: LoadedSource) {
  return {
    id: s.id,
    name: s.info.name,
    description: s.info.description,
    version: s.info.version,
    author: s.info.author,
    homepage: s.info.homepage,
    status: s.status,
    enabled: s.enabled,
    errorMessage: s.errorMessage,
    platforms: Object.entries(s.sources).map(([platform, info]) => ({
      platform,
      actions: info.actions,
      qualitys: info.qualitys,
    })),
  }
}

interface ImportContentBody {
  name?: string
  content?: string
}
interface ImportUrlBody {
  url?: string
  name?: string
}

export async function sourceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/sources', async () => {
    return { sources: sourceEngine.list().map(view) }
  })

  app.post<{ Body: ImportContentBody }>('/api/v1/sources/import/content', async (req, reply) => {
    const { name, content } = req.body ?? {}
    if (!content) return reply.code(400).send({ error: 'content is required' })
    try {
      const rec = await sourceEngine.importFromContent(name || `source-${Date.now()}`, content)
      return reply.code(201).send(view(rec))
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  app.post<{ Body: ImportUrlBody }>('/api/v1/sources/import/url', async (req, reply) => {
    const { url, name } = req.body ?? {}
    if (!url) return reply.code(400).send({ error: 'url is required' })
    try {
      const rec = await sourceEngine.importFromUrl(url, name)
      return reply.code(201).send(view(rec))
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  // multipart 文件上传（前端 <input type=file>）
  app.post('/api/v1/sources/upload', async (req, reply) => {
    const mp = await (req as unknown as { file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> } | undefined> }).file()
    if (!mp) return reply.code(400).send({ error: 'no file uploaded' })
    const buf = await mp.toBuffer()
    const content = buf.toString('utf8')
    try {
      const rec = await sourceEngine.importFromContent(mp.filename || `source-${Date.now()}`, content)
      return reply.code(201).send(view(rec))
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  app.patch<{ Params: { id: string }; Body: { enabled?: boolean } }>('/api/v1/sources/:id/enabled', async (req, reply) => {
    const { enabled } = req.body ?? {}
    if (typeof enabled !== 'boolean') return reply.code(400).send({ error: 'enabled (boolean) is required' })
    try {
      sourceEngine.setEnabled(req.params.id, enabled)
      return { id: req.params.id, enabled }
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message })
    }
  })

  app.post<{ Params: { id: string } }>('/api/v1/sources/:id/reload', async (req, reply) => {
    const rec = sourceEngine.get(req.params.id)
    if (!rec) return reply.code(404).send({ error: 'source not found' })
    try {
      await sourceEngine.load(rec.file)
      const updated = sourceEngine.get(req.params.id)
      return updated ? view(updated) : reply.code(500).send({ error: 'reload failed' })
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/sources/:id', async (req, reply) => {
    if (!sourceEngine.get(req.params.id)) return reply.code(404).send({ error: 'source not found' })
    await sourceEngine.remove(req.params.id)
    return { id: req.params.id, deleted: true }
  })
}
