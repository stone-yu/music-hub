/**
 * 搜索路由
 *   GET /api/v1/search?keyword=晴天&platform=kw&page=1&limit=20   单平台
 *   GET /api/v1/search/aggregate?keyword=晴天&platforms=kw,wy&page=1  聚合(默认全平台)
 */
import type { FastifyInstance } from 'fastify'
import { searchService, isPlatform, ALL_PLATFORMS, type Platform } from '../core/search/index.js'

interface SearchQuery {
  keyword?: string
  platform?: string
  page?: string
  limit?: string
  platforms?: string
}

interface SongListDetailQuery {
  platform?: string
  id?: string
  page?: string
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: SearchQuery }>('/api/v1/search', async (req, reply) => {
    const { keyword, platform = 'kw', page = '1', limit } = req.query
    if (!keyword) return reply.code(400).send({ error: 'keyword is required' })
    if (!isPlatform(platform)) return reply.code(400).send({ error: `unknown platform: ${platform}`, valid: ALL_PLATFORMS })
    const result = await searchService.searchPlatform(platform, keyword, parseInt(page) || 1, limit ? parseInt(limit) : undefined)
    return result
  })

  app.get<{ Querystring: SearchQuery }>('/api/v1/search/aggregate', async (req, reply) => {
    const { keyword, page = '1', limit, platforms } = req.query
    if (!keyword) return reply.code(400).send({ error: 'keyword is required' })
    let targets: Platform[] = ALL_PLATFORMS
    if (platforms) {
      const parsed = platforms.split(',').map((p) => p.trim()).filter(Boolean)
      const invalid = parsed.filter((p) => !isPlatform(p))
      if (invalid.length) return reply.code(400).send({ error: `unknown platform(s): ${invalid.join(',')}`, valid: ALL_PLATFORMS })
      targets = parsed as Platform[]
    }
    const result = await searchService.searchAggregate(keyword, parseInt(page) || 1, targets, limit ? parseInt(limit) : undefined)
    return result
  })

  // 歌单搜索（单平台）
  app.get<{ Querystring: SearchQuery }>('/api/v1/search/songlist', async (req, reply) => {
    const { keyword, platform = 'kw', page = '1', limit } = req.query
    if (!keyword) return reply.code(400).send({ error: 'keyword is required' })
    if (!isPlatform(platform)) return reply.code(400).send({ error: `unknown platform: ${platform}`, valid: ALL_PLATFORMS })
    const result = await searchService.searchSongList(platform, keyword, parseInt(page) || 1, limit ? parseInt(limit) : undefined)
    return result
  })

  // 歌单搜索（聚合，默认全平台）
  app.get<{ Querystring: SearchQuery }>('/api/v1/search/songlist/aggregate', async (req, reply) => {
    const { keyword, page = '1', limit, platforms } = req.query
    if (!keyword) return reply.code(400).send({ error: 'keyword is required' })
    let targets: Platform[] = ALL_PLATFORMS
    if (platforms) {
      const parsed = platforms.split(',').map((p) => p.trim()).filter(Boolean)
      const invalid = parsed.filter((p) => !isPlatform(p))
      if (invalid.length) return reply.code(400).send({ error: `unknown platform(s): ${invalid.join(',')}`, valid: ALL_PLATFORMS })
      targets = parsed as Platform[]
    }
    const result = await searchService.searchSongListAggregate(keyword, parseInt(page) || 1, targets, limit ? parseInt(limit) : undefined)
    return result
  })

  // 歌单详情（含歌曲列表，可直接下载/整单下载）
  app.get<{ Querystring: SongListDetailQuery }>('/api/v1/search/songlist/detail', async (req, reply) => {
    const { platform = 'kw', id, page = '1' } = req.query
    if (!id) return reply.code(400).send({ error: 'id is required' })
    if (!isPlatform(platform)) return reply.code(400).send({ error: `unknown platform: ${platform}`, valid: ALL_PLATFORMS })
    const result = await searchService.getSongListDetail(platform, id, parseInt(page) || 1)
    return result
  })
}
