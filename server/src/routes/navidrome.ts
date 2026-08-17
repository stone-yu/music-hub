/**
 * Navidrome 曲库 + AI 歌单路由
 *   GET  /api/v1/navidrome/status                         连接/库大小/加载状态
 *   POST /api/v1/navidrome/library/refresh?scan_first=    触发刷新（可选先扫描）
 *   POST /api/v1/navidrome/match                          搜歌→匹配库→matched/unmatched
 *   POST /api/v1/navidrome/match/songs                    按歌曲列表逐首匹配（保留 index 对应表格行）
 *   POST /api/v1/navidrome/playlist/create                用 Navidrome 库内歌曲 ID 创建歌单（不带封面，降级用自动封面）
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
    const { name, song_ids } = req.body ?? {}
    if (!name?.trim()) return reply.code(400).send({ error: 'name is required' })
    if (!song_ids?.length) return reply.code(400).send({ error: 'song_ids is required' })
    const playlistId = await navidromeClient.createPlaylist(name.trim(), song_ids)
    if (!playlistId) return reply.code(500).send({ error: '创建歌单失败' })
    return { success: true, playlistId, playlistName: name, songCount: song_ids.length }
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
