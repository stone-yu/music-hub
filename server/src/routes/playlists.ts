/**
 * 歌单管理路由（首版）
 *   GET    /api/v1/playlists              歌单列表（含歌曲数）
 *   POST   /api/v1/playlists              创建 { name, description? }
 *   GET    /api/v1/playlists/:id          歌单详情（含歌曲）
 *   PATCH  /api/v1/playlists/:id          改名 { name, description? }
 *   DELETE /api/v1/playlists/:id          删除
 *   POST   /api/v1/playlists/:id/items    添加歌曲 { platform, musicInfo }
 *   DELETE /api/v1/playlists/:id/items/:itemId  移除歌曲
 *   POST   /api/v1/playlists/:id/download 整单批量下载 { quality? }
 */
import type { FastifyInstance } from 'fastify'
import { playlistStore } from '../core/db/playlists.js'
import { downloadQueue } from '../core/download/queue.js'
import { isPlatform, ALL_PLATFORMS } from '../core/search/index.js'
import type { MusicInfo } from '../core/adapters/common.js'
import type { Quality } from '../core/source-engine/lx-env.js'

const VALID_QUALITIES: Quality[] = ['flac24bit', 'flac', '320k', '128k']

export async function playlistRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/playlists', async () => {
    return { playlists: playlistStore.list() }
  })

  app.post<{ Body: { name?: string; description?: string } }>('/api/v1/playlists', async (req, reply) => {
    const { name, description } = req.body ?? {}
    if (!name || !name.trim()) return reply.code(400).send({ error: 'name is required' })
    const row = playlistStore.create(name.trim(), description ?? '')
    return reply.code(201).send(row)
  })

  app.get<{ Params: { id: string } }>('/api/v1/playlists/:id', async (req, reply) => {
    const p = playlistStore.get(req.params.id)
    if (!p) return reply.code(404).send({ error: 'playlist not found' })
    const items = playlistStore.items(req.params.id).map((it) => ({
      id: it.id,
      platform: it.platform,
      songmid: it.songmid,
      name: it.name,
      singer: it.singer,
      album: it.album,
      musicInfo: JSON.parse(it.music_info) as MusicInfo,
    }))
    return { ...p, items }
  })

  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string } }>('/api/v1/playlists/:id', async (req, reply) => {
    const { name, description } = req.body ?? {}
    if (!name || !name.trim()) return reply.code(400).send({ error: 'name is required' })
    const ok = playlistStore.rename(req.params.id, name.trim(), description)
    if (!ok) return reply.code(404).send({ error: 'playlist not found' })
    return { id: req.params.id, name: name.trim() }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/playlists/:id', async (req, reply) => {
    const ok = playlistStore.remove(req.params.id)
    if (!ok) return reply.code(404).send({ error: 'playlist not found' })
    return { id: req.params.id, deleted: true }
  })

  app.post<{ Params: { id: string }; Body: { platform?: string; musicInfo?: MusicInfo } }>('/api/v1/playlists/:id/items', async (req, reply) => {
    const { platform, musicInfo } = req.body ?? {}
    if (!playlistStore.get(req.params.id)) return reply.code(404).send({ error: 'playlist not found' })
    if (!platform || !isPlatform(platform)) return reply.code(400).send({ error: 'invalid platform', valid: ALL_PLATFORMS })
    if (!musicInfo || !musicInfo.songmid || !musicInfo.name) return reply.code(400).send({ error: 'musicInfo (with songmid & name) is required' })
    const added = playlistStore.addItem(req.params.id, platform, musicInfo)
    return reply.code(added ? 201 : 200).send({ added, message: added ? '已添加' : '歌曲已存在' })
  })

  app.delete<{ Params: { id: string; itemId: string } }>('/api/v1/playlists/:id/items/:itemId', async (req, reply) => {
    const ok = playlistStore.removeItem(req.params.id, req.params.itemId)
    if (!ok) return reply.code(404).send({ error: 'item not found' })
    return { id: req.params.itemId, deleted: true }
  })

  // 整单批量下载：把歌单里所有歌曲入队
  app.post<{ Params: { id: string }; Body: { quality?: Quality } }>('/api/v1/playlists/:id/download', async (req, reply) => {
    if (!playlistStore.get(req.params.id)) return reply.code(404).send({ error: 'playlist not found' })
    const quality = req.body?.quality ?? 'flac'
    if (!VALID_QUALITIES.includes(quality)) return reply.code(400).send({ error: 'invalid quality', valid: VALID_QUALITIES })
    const items = playlistStore.items(req.params.id)
    if (!items.length) return reply.code(400).send({ error: 'playlist is empty' })
    const accepted: { id: string; name: string }[] = []
    for (const it of items) {
      const musicInfo = JSON.parse(it.music_info) as MusicInfo
      if (!isPlatform(it.platform)) continue
      const id = downloadQueue.enqueue({ platform: it.platform, musicInfo, quality })
      accepted.push({ id, name: it.name })
    }
    return reply.code(201).send({ acceptedCount: accepted.length, accepted })
  })
}
