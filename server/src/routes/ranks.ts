/**
 * 排行榜路由
 *   GET /api/v1/ranks                  各平台榜单列表
 *   GET /api/v1/ranks/:source/:id      某榜单歌曲列表（MusicInfo[]，可直接试听/下载/匹配）
 */
import type { FastifyInstance } from 'fastify'
import { getAllRanks, getRankSongs, RANK_SOURCES } from '../core/ranks.js'

export async function rankRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/ranks', async () => {
    return { ranks: await getAllRanks() }
  })

  app.get<{ Params: { source: string; id: string }; Querystring: { limit?: string } }>('/api/v1/ranks/:source/:id', async (req, reply) => {
    const { source, id } = req.params
    if (!RANK_SOURCES.includes(source)) return reply.code(400).send({ error: `invalid source: ${source}`, valid: RANK_SOURCES })
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit), 200) : 100
    try {
      return { source, id, list: await getRankSongs(source, id, limit) }
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })
}
