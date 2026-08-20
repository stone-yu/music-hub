/**
 * Navidrome 曲库 + AI 歌单路由
 *   GET  /api/v1/navidrome/status                         连接/库大小/加载状态
 *   GET  /api/v1/navidrome/stats                          曲库统计 + 歌单列表（只读）
 *   GET  /api/v1/navidrome/songs                          曲库歌曲列表（含封面/时长/格式）
 *   GET  /api/v1/navidrome/playlist/:id                   歌单详情（含内含歌曲）
 *   GET  /api/v1/navidrome/cover/:id                      封面图代理（凭据不暴露给浏览器）
 *   GET  /api/v1/navidrome/stream/:id                     流式播放代理
 *   POST /api/v1/navidrome/library/refresh?scan_first=    触发刷新（可选先扫描）
 *   POST /api/v1/navidrome/match                          搜歌→匹配库→matched/unmatched
 *   POST /api/v1/navidrome/match/songs                    按歌曲列表逐首匹配（保留 index 对应表格行）
 *   POST /api/v1/navidrome/playlist/create                用 Navidrome 库内歌曲 ID 创建歌单（不带封面，降级用自动封面）
 *   POST /api/v1/navidrome/playlist/update?id=            更新歌单元信息（改名 name / 改描述 desc）
 *   POST /api/v1/navidrome/playlist/:id/remove            从歌单移除单曲（body: song_id）
 *   DELETE /api/v1/navidrome/playlist/:id                  删除歌单
 *   GET  /api/v1/navidrome/starred                         已收藏歌曲 id 列表
 *   POST /api/v1/navidrome/star/:id                        收藏歌曲
 *   POST /api/v1/navidrome/unstar/:id                      取消收藏歌曲
 */
import type { FastifyInstance } from 'fastify'
import { navidromeClient } from '../core/navidrome/client.js'
import { library } from '../core/library/cache.js'
import { matchSongs, matchOne, type MatchInput } from '../core/library/match.js'
import { searchService, isPlatform, ALL_PLATFORMS, type Platform } from '../core/search/index.js'
import type { MusicInfo } from '../core/adapters/common.js'

interface RefreshQuery {
  scan_first?: string
}

interface MatchBody {
  keyword?: string
  platforms?: string[]
  quality?: string
}

interface CreatePlaylistBody {
  name?: string
  song_ids?: string[]
  desc?: string
}

interface UpdatePlaylistBody {
  name?: string
  desc?: string
}

interface RemoveSongBody {
  song_id?: string
}

function toMatchInput(list: MusicInfo[], platform: Platform): MatchInput[] {
  return list.map((s) => ({ title: s.name, artist: s.singer, source: platform }))
}

export async function navidromeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/navidrome/status', async () => {
    const connected = await navidromeClient.ping()
    const st = library.getStatus()
    return {
      connected,
      librarySize: st.size,
      libraryLoading: st.loading,
      everLoaded: st.everLoaded,
      lastUpdate: library.lastUpdate,
    }
  })

  // 曲库统计：歌曲数/艺术家数/专辑数 + Navidrome 歌单列表（只读）
  app.get('/api/v1/navidrome/stats', async () => {
    const songs = library.getSongs()
    const artists = new Set(songs.map((s) => s.artist))
    const albums = new Set(songs.map((s) => s.album).filter(Boolean))
    let playlists: any[] = []
    try { playlists = await navidromeClient.getPlaylists() } catch { /* best-effort */ }
    return {
      songCount: songs.length,
      artistCount: artists.size,
      albumCount: albums.size,
      playlists: playlists.map((p: any) => ({
        id: String(p.id ?? ''),
        name: p.name ?? '',
        songCount: p.songCount ?? 0,
        public: p.public ?? false,
        owner: p.owner ?? '',
        coverArt: String(p.coverArt ?? '') || null,
      })),
    }
  })

  // 曲库歌曲列表（来自本地缓存，含封面/时长/格式，供"曲库歌曲"页）
  app.get('/api/v1/navidrome/songs', async () => {
    const songs = library.getSongs()
    return {
      total: songs.length,
      loading: library.getStatus().loading,
      songs: songs.map((s) => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        album: s.album,
        coverArt: s.coverArt ?? null,
        duration: s.duration ?? null,
        suffix: s.suffix ?? null,
        playCount: s.playCount ?? null,
      })),
    }
  })

  // 歌单详情（含内含歌曲，供"曲库歌单"页点击进入详情）
  app.get<{ Params: { id: string } }>('/api/v1/navidrome/playlist/:id', async (req, reply) => {
    const r = await navidromeClient.getPlaylist(req.params.id)
    if (!r?.playlist) return reply.code(404).send({ error: '歌单不存在或获取失败' })
    const pl: any = r.playlist
    const entries = (pl.entry ?? []).map((s: any) => ({
      id: String(s.id ?? ''),
      title: s.title ?? '',
      artist: s.artist ?? '',
      album: s.album ?? '',
      coverArt: String(s.coverArt ?? '') || null,
      duration: typeof s.duration === 'number' ? s.duration : null,
      suffix: typeof s.suffix === 'string' ? s.suffix : null,
      playCount: typeof s.playCount === 'number' ? s.playCount : null,
    }))
    return {
      id: String(pl.id ?? ''),
      name: pl.name ?? '',
      songCount: pl.songCount ?? entries.length,
      public: pl.public ?? false,
      owner: pl.owner ?? '',
      coverArt: String(pl.coverArt ?? '') || null,
      comment: pl.comment ?? '',
      songs: entries,
    }
  })

  // 封面图代理：凭据不暴露给浏览器，前端 <img src="/cover/:id">
  app.get<{ Params: { id: string } }>('/api/v1/navidrome/cover/:id', async (req, reply) => {
    const buf = await navidromeClient.getCoverArt(req.params.id)
    if (!buf) return reply.code(404).send({ error: '封面不存在' })
    reply.header('Cache-Control', 'public, max-age=86400')
    return reply.type('image/jpeg').send(buf)
  })

  // 流式播放代理：fetch navidrome stream 端点并转发 Web 流到 <audio>（凭据不暴露给浏览器）
  const SUFFIX_MIME: Record<string, string> = {
    mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg',
    opus: 'audio/ogg', m4a: 'audio/mp4', m4b: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac',
  }
  app.get<{ Params: { id: string } }>('/api/v1/navidrome/stream/:id', async (req, reply) => {
    const song = library.getSongs().find((s) => s.id === req.params.id)
    const mime = (song?.suffix && SUFFIX_MIME[song.suffix.toLowerCase()]) || 'audio/mpeg'
    try {
      const upstream = await fetch(navidromeClient.streamUrl(req.params.id), { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!upstream.ok || !upstream.body) return reply.code(502).send({ error: `upstream ${upstream.status}` })
      reply.header('Content-Type', upstream.headers.get('content-type') || mime)
      return reply.send(upstream.body)
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })

  app.post<{ Querystring: RefreshQuery }>('/api/v1/navidrome/library/refresh', async (req) => {
    const scanFirst = req.query.scan_first === 'true' || req.query.scan_first === '1'
    library.refresh(scanFirst)
    return { status: 'ok', scanning: library.getStatus().loading }
  })

  app.post<{ Body: MatchBody }>('/api/v1/navidrome/match', async (req, reply) => {
    const { keyword, platforms } = req.body ?? {}
    if (!keyword?.trim()) return reply.code(400).send({ error: 'keyword is required' })

    // 确定搜索平台
    let targets: Platform[] = ALL_PLATFORMS
    if (platforms?.length) {
      const parsed = platforms.filter((p): p is Platform => isPlatform(p))
      if (parsed.length) targets = parsed
    }

    const agg = await searchService.searchAggregate(keyword.trim(), 1, targets)
    // 汇总各平台结果为 MatchInput，跨平台去重（按 searchMatchKey）
    const allSongs: MatchInput[] = []
    const seen = new Set<string>()
    const sourceStats: { platform: string; total: number; ok: boolean }[] = []
    for (const r of agg.results) {
      sourceStats.push({ platform: r.platform, total: r.total, ok: r.ok })
      for (const s of r.list) {
        const input = toMatchInput([s], r.platform)[0]!
        const dedupKey = `${input.title}|${input.artist}`.toLowerCase()
        if (seen.has(dedupKey)) continue
        seen.add(dedupKey)
        allSongs.push(input)
      }
    }

    const libIndex = library.getIndex()
    const { matched, unmatched } = matchSongs(allSongs, libIndex)
    return {
      keyword: agg.keyword,
      sourceStats,
      searchTotal: allSongs.length,
      matched,
      matchedCount: matched.length,
      unmatched: unmatched.slice(0, 50),
      unmatchedCount: unmatched.length,
    }
  })

  app.post<{ Body: CreatePlaylistBody }>('/api/v1/navidrome/playlist/create', async (req, reply) => {
    const { name, song_ids, desc } = req.body ?? {}
    if (!name?.trim()) return reply.code(400).send({ error: 'name is required' })
    if (!song_ids?.length) return reply.code(400).send({ error: 'song_ids is required' })
    const playlistId = await navidromeClient.createPlaylist(name.trim(), song_ids, undefined, desc?.trim() || undefined)
    if (!playlistId) return reply.code(500).send({ error: '创建歌单失败' })
    return { success: true, playlistId, playlistName: name, songCount: song_ids.length }
  })

  // 更新歌单元信息：改名(name) + 改描述(desc)，可任意组合
  app.post<{ Body: UpdatePlaylistBody }>('/api/v1/navidrome/playlist/update', async (req, reply) => {
    const { name, desc } = req.body ?? {}
    if (!name?.trim() && desc === undefined) return reply.code(400).send({ error: 'name 或 desc 至少传一个' })
    // playlistId 从 query 取（与 create 区分，update 需指定目标歌单）
    const id = (req.query as { id?: string }).id
    if (!id) return reply.code(400).send({ error: 'id is required' })
    const ok = await navidromeClient.updatePlaylist(id, { name: name?.trim() || undefined, comment: desc })
    if (!ok) return reply.code(500).send({ error: '更新歌单失败' })
    return { success: true }
  })

  // 从歌单移除单曲（按歌曲在歌单中的索引）
  app.post<{ Params: { id: string }; Body: RemoveSongBody }>('/api/v1/navidrome/playlist/:id/remove', async (req, reply) => {
    const { id } = req.params
    const { song_id } = req.body ?? {}
    if (!song_id) return reply.code(400).send({ error: 'song_id is required' })
    // 取歌单详情定位歌曲索引
    const r = await navidromeClient.getPlaylist(id)
    const entries = r?.playlist?.entry ?? []
    const index = entries.findIndex((s: any) => String(s.id) === song_id)
    if (index < 0) return reply.code(404).send({ error: '歌曲不在歌单中' })
    const ok = await navidromeClient.removePlaylistSong(id, index)
    if (!ok) return reply.code(500).send({ error: '移出失败' })
    return { success: true, removedIndex: index }
  })

  // 删除歌单
  app.delete<{ Params: { id: string } }>('/api/v1/navidrome/playlist/:id', async (req, reply) => {
    const ok = await navidromeClient.deletePlaylist(req.params.id)
    if (!ok) return reply.code(500).send({ error: '删除歌单失败' })
    return { success: true }
  })

  // 已收藏歌曲 id 列表（供曲库歌曲页批量比对收藏状态）
  app.get('/api/v1/navidrome/starred', async () => {
    const ids = await navidromeClient.getStarredSongIds()
    return { ids: Array.from(ids) }
  })

  // 收藏歌曲
  app.post<{ Params: { id: string } }>('/api/v1/navidrome/star/:id', async (req, reply) => {
    const ok = await navidromeClient.starSong(req.params.id)
    if (!ok) return reply.code(500).send({ error: '收藏失败' })
    return { success: true }
  })

  // 取消收藏歌曲
  app.post<{ Params: { id: string } }>('/api/v1/navidrome/unstar/:id', async (req, reply) => {
    const ok = await navidromeClient.unstarSong(req.params.id)
    if (!ok) return reply.code(500).send({ error: '取消收藏失败' })
    return { success: true }
  })

  // 按歌曲列表逐首匹配（保留 index 对应前端表格行，不去重）。供搜索结果/歌单详情打"已在曲库"标记。
  app.post<{ Body: { songs?: MatchInput[] } }>('/api/v1/navidrome/match/songs', async (req, reply) => {
    const { songs } = req.body ?? {}
    if (!Array.isArray(songs) || !songs.length) return reply.code(400).send({ error: 'songs (non-empty) required' })
    const libIndex = library.getIndex()
    const results = songs.map((s, index) => {
      const { matched, isFuzzy } = matchOne(s, libIndex)
      return matched
        ? { index, matched: true, libId: matched.id, libTitle: matched.title, libArtist: matched.artist, album: matched.album, isFuzzy }
        : { index, matched: false }
    })
    return { results, librarySize: library.getStatus().size }
  })
}
