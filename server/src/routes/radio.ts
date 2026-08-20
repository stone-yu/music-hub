/**
 * 广播电台路由
 *   GET /api/v1/radio5/categories                     分类目录（快捷标签 + 四维，静态）
 *   GET /api/v1/radio5/stations?cat={path}            按分类抓电台列表（cat 为 radio5 子路径，已编码）
 *   GET /api/v1/radio5/search?q={keyword}             全站搜索电台
 *   GET /api/v1/radio5/stream/:slug                   解析 slug→id→streamUrl，返回播放流地址（时效 key）
 *   GET /api/v1/navidrome/radio                       Navidrome 网络电台列表（直链 mp3）
 */
import type { FastifyInstance } from 'fastify'
import { radio5Client } from '../core/radio5/client.js'
import { radioCatalog } from '../core/radio5/catalog.js'
import { navidromeClient } from '../core/navidrome/client.js'

interface StationsQuery {
  cat?: string
}
interface SearchQuery {
  q?: string
}

export async function radioRoutes(app: FastifyInstance): Promise<void> {
  // 分类目录（静态，纯数据返回）
  app.get('/api/v1/radio5/categories', async () => {
    return radioCatalog
  })

  // 按分类抓电台列表
  app.get<{ Querystring: StationsQuery }>('/api/v1/radio5/stations', async (req, reply) => {
    const { cat } = req.query
    if (!cat?.trim()) return reply.code(400).send({ error: 'cat (category path) is required' })
    // cat 已由前端 encodeURIComponent 编码（含中文如 fm/市县台），decode 后传给 client
    const path = decodeURIComponent(cat.trim())
    const list = await radio5Client.getStationsByCategory(path)
    return { total: list.length, stations: list }
  })

  // 全站搜索电台
  app.get<{ Querystring: SearchQuery }>('/api/v1/radio5/search', async (req, reply) => {
    const { q } = req.query
    if (!q?.trim()) return reply.code(400).send({ error: 'q (keyword) is required' })
    const list = await radio5Client.searchStations(q.trim())
    return { total: list.length, stations: list }
  })

  // 取播放流（slug → id → streamUrl，时效 key 现取）
  app.get<{ Params: { slug: string } }>('/api/v1/radio5/stream/:slug', async (req, reply) => {
    const stream = await radio5Client.getStream(req.params.slug)
    if (!stream) return reply.code(502).send({ error: '解析电台流失败' })
    return stream
  })

  // Navidrome 网络电台列表（直链 mp3，前端原生 audio 播放）
  app.get('/api/v1/navidrome/radio', async (req, reply) => {
    const connected = await navidromeClient.ping()
    if (!connected) return reply.code(502).send({ error: 'Navidrome 连接失败' })
    try {
      const stations = await navidromeClient.getInternetRadioStations()
      return { total: stations.length, stations }
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message })
    }
  })
}
