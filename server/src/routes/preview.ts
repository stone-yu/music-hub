/**
 * 试听路由
 *   POST /api/v1/preview           取 128k 试听直链（遍历音源，第一个成功的返回）
 *   GET  /api/v1/preview/proxy     流式代理（防盗链/Referer 校验时用）
 *
 * 容错：音源全失败 → 503 + 错误信息；前端 audio.onerror 切 /preview/proxy 重试。
 */
import type { FastifyInstance } from 'fastify'
import { sourceEngine } from '../core/source-engine/index.js'
import { isPlatform, type Platform } from '../core/search/index.js'
import type { MusicInfo } from '../core/adapters/common.js'
import type { Quality } from '../core/source-engine/lx-env.js'

interface PreviewBody {
  platform?: string
  musicInfo?: MusicInfo
  quality?: Quality
}

export async function previewRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: PreviewBody }>('/api/v1/preview', async (req, reply) => {
    const { platform, musicInfo, quality = '128k' } = req.body ?? {}
    if (!platform || !isPlatform(platform)) return reply.code(400).send({ error: 'invalid platform' })
    if (!musicInfo || !musicInfo.songmid || !musicInfo.name) return reply.code(400).send({ error: 'musicInfo required (songmid+name)' })

    const candidates = sourceEngine.list().filter(
      (s) => s.status === 'ready' && s.enabled && s.sources[platform as Platform]?.qualitys?.includes(quality),
    )
    if (!candidates.length) return reply.code(503).send({ error: '没有可用音源支持该平台试听' })

    let lastErr = ''
    for (const src of candidates) {
      try {
        const url = await sourceEngine.getMusicUrlExact(src.id, platform, musicInfo, quality)
        if (url && /^https?:\/\//.test(url)) return { url, quality, sourceId: src.id }
      } catch (err) {
        lastErr = (err as Error).message
      }
    }
    return reply.code(503).send({ error: `试听取链失败（音源可能失效）：${lastErr}` })
  })

  app.get<{ Querystring: { url?: string } }>('/api/v1/preview/proxy', async (req, reply) => {
    const { url } = req.query
    if (!url || !/^https?:\/\//.test(url)) return reply.code(400).send({ error: 'invalid url' })
    try {
      const upstream = await fetch(url, { headers: { Referer: '', 'User-Agent': 'Mozilla/5.0' } })
      if (!upstream.ok || !upstream.body) return reply.code(502).send({ error: `upstream ${upstream.status}` })
      reply.header('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg')
      // Node 24 ReadableStream → Fastify 可直接 send Web Stream
      return reply.send(upstream.body)
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })
}
