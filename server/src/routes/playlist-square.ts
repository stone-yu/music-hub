/**
 * 歌单广场路由
 *   GET  /api/v1/square/hot?platform=           广场预设热门关键词歌单（不指定平台则全平台）
 *   GET  /api/v1/square/search?keyword=&platforms=   按关键词搜歌单
 *   GET  /api/v1/square/resolve?url=            解析分享 URL → 歌单详情（含歌曲列表，可直接下载）
 */
import type { FastifyInstance } from 'fastify'
import { playlistSquare, isPlatform, ALL_PLATFORMS } from '../core/playlist-square/resolver.js'
import type { Platform } from '../core/search/index.js'

interface SquareQuery {
  platform?: string
  id?: string
  keyword?: string
  platforms?: string
  url?: string
}

export async function playlistSquareRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: SquareQuery }>('/api/v1/square/hot', async (req, reply) => {
    const { platform } = req.query
    let p: Platform | undefined
    if (platform) {
      if (!isPlatform(platform)) return reply.code(400).send({ error: `unknown platform: ${platform}`, valid: ALL_PLATFORMS })
      p = platform
    }
    return { groups: await playlistSquare.hot(p) }
  })

  app.get<{ Querystring: SquareQuery }>('/api/v1/square/search', async (req, reply) => {
    const { keyword, platforms } = req.query
    if (!keyword?.trim()) return reply.code(400).send({ error: 'keyword is required' })
    let targets: Platform[] = ALL_PLATFORMS
    if (platforms) {
      const parsed = platforms.split(',').map((x) => x.trim()).filter(Boolean)
      const invalid = parsed.filter((x) => !isPlatform(x))
      if (invalid.length) return reply.code(400).send({ error: `unknown platform(s): ${invalid.join(',')}`, valid: ALL_PLATFORMS })
      targets = parsed as Platform[]
    }
    return playlistSquare.search(keyword.trim(), targets)
  })

  app.get<{ Querystring: SquareQuery }>('/api/v1/square/resolve', async (req, reply) => {
    const { url } = req.query
    if (!url?.trim()) return reply.code(400).send({ error: 'url is required' })
    try {
      return await playlistSquare.resolveUrl(url.trim())
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  app.get<{ Querystring: SquareQuery }>('/api/v1/square/detail', async (req, reply) => {
    const { platform, id } = req.query
    if (!platform || !isPlatform(platform)) return reply.code(400).send({ error: 'invalid platform', valid: ALL_PLATFORMS })
    if (!id) return reply.code(400).send({ error: 'id is required' })
    try {
      const detail = await playlistSquare.getDetail(platform, id)
      return { platform, id, detail }
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })
}
