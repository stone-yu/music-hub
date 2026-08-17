/**
 * 各平台歌曲排行榜（网易/QQ/酷狗）— 移植自 MusicHub 原 hot_songs.py
 * 排行榜本质是固定歌单，复用 MusicInfo 给前端（可直接试听/下载/匹配）。
 */
import needle from 'needle'
import { logger } from './logger.js'
import type { MusicInfo } from './adapters/common.js'

export interface Rank {
  id: string
  name: string
  source: string // 平台代号 wy/tx/kg
  cover_url: string
}

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }

// 网易云固定榜单 playlist id
const NETEASE_RANKS: Rank[] = [
  { id: '3778678', name: '热歌榜', source: 'wy', cover_url: '' },
  { id: '3779629', name: '新歌榜', source: 'wy', cover_url: '' },
  { id: '19723756', name: '飙升榜', source: 'wy', cover_url: '' },
  { id: '2884035', name: '原创榜', source: 'wy', cover_url: '' },
  { id: '991319590', name: '中文说唱榜', source: 'wy', cover_url: '' },
]

async function getJson(url: string, params?: Record<string, string>): Promise<any | null> {
  try {
    const resp = await needle('get', url, params ?? {}, { response_timeout: 15_000, follow_max: 3, json: false })
    const body = resp.body
    if (typeof body === 'string') return JSON.parse(body)
    return body
  } catch (err) {
    logger.warn({ err: (err as Error).message, url }, '[ranks] request failed')
    return null
  }
}

// ---------- 网易云 ----------
async function neteaseRanks(): Promise<Rank[]> {
  // 封面懒取（列表接口不带封面，详情才带）；这里返回固定列表，封面留空
  return NETEASE_RANKS
}
async function neteaseRankSongs(rankId: string, limit = 100): Promise<MusicInfo[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await getJson('http://music.163.com/api/playlist/detail', { id: rankId })
    if (!data) return []
    try {
      const result = data.result ?? data.playlist ?? {}
      const tracks = result.tracks ?? []
      const songs: MusicInfo[] = []
      for (const t of tracks.slice(0, limit)) {
        const artists = (t.artists ?? t.ar ?? []).map((a: any) => a.name ?? '').join('/')
        const album = (t.album ?? t.al ?? {}).name ?? ''
        if (t.name && artists) {
          songs.push({ name: t.name, singer: artists, source: 'wy', songmid: String(t.id), albumName: album, types: [], _types: {} })
        }
      }
      if (songs.length) return songs
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[ranks] netease parse failed')
      return []
    }
  }
  return []
}

// ---------- QQ音乐 ----------
async function qqRanks(): Promise<Rank[]> {
  const dataStr = '{"comm":{"ct":24,"cv":4747474},"toplist":{"module":"musicToplist.ToplistInfoServer","method":"GetAll","param":{}}}'
  const data = await getJson('https://u.y.qq.com/cgi-bin/musicu.fcg', { data: dataStr })
  if (!data) return []
  const ranks: Rank[] = []
  try {
    const groups = data.toplist?.data?.group ?? []
    for (const g of groups) {
      for (const t of g.toplist ?? []) {
        const tid = String(t.topId ?? '')
        if (tid) ranks.push({ id: tid, name: (t.title ?? '').trim(), source: 'tx', cover_url: t.picUrl ?? '' })
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '[ranks] qq list parse failed')
  }
  return ranks
}
async function qqRankSongs(rankId: string, limit = 100): Promise<MusicInfo[]> {
  const dataStr = `{"comm":{"ct":24,"cv":4747474},"toplist":{"module":"musicToplist.ToplistInfoServer","method":"GetDetail","param":{"topId":${rankId},"offset":0,"num":${limit}}}}`
  const data = await getJson('https://u.y.qq.com/cgi-bin/musicu.fcg', { data: dataStr })
  if (!data) return []
  const songs: MusicInfo[] = []
  try {
    const list = data.toplist?.data?.songInfoList ?? []
    for (const s of list) {
      const artists = (s.singer ?? []).map((si: any) => si.name ?? '').join('/')
      const album = s.album?.name ?? ''
      if (s.title && artists) {
        songs.push({ name: s.title, singer: artists, source: 'tx', songmid: String(s.mid ?? s.id ?? ''), albumName: album, types: [], _types: {} })
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '[ranks] qq songs parse failed')
  }
  return songs
}

// ---------- 酷狗 ----------
async function kugouRanks(): Promise<Rank[]> {
  const data = await getJson('http://mobilecdn.kugou.com/api/v3/rank/list', { version: '9108', page: '1', pagesize: '30' })
  if (!data) return []
  const ranks: Rank[] = []
  try {
    for (const item of data.data?.info ?? []) {
      const rid = String(item.rankid ?? '')
      if (rid) ranks.push({ id: rid, name: (item.rankname ?? '').trim(), source: 'kg', cover_url: item.banner_9 ?? item.base_img ?? '' })
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '[ranks] kugou list parse failed')
  }
  return ranks
}
async function kugouRankSongs(rankId: string, limit = 100): Promise<MusicInfo[]> {
  const data = await getJson('http://mobilecdn.kugou.com/api/v3/rank/song', { rankid: rankId, page: '1', pagesize: String(limit), version: '9108' })
  if (!data) return []
  const songs: MusicInfo[] = []
  try {
    for (const item of data.data?.info ?? []) {
      let title = item.songname ?? ''
      let artist = item.singername ?? ''
      if (!artist && item.filename && item.filename.includes(' - ')) {
        const parts = item.filename.split(' - ', 2)
        artist = parts[0]!.trim()
        if (!title) title = parts[1]!.trim()
      }
      if (title && artist) {
        songs.push({ name: title, singer: artist, source: 'kg', songmid: String(item.hash ?? item.songid ?? ''), albumName: item.albumname ?? '', types: [], _types: {} })
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '[ranks] kugou songs parse failed')
  }
  return songs
}

// ---------- 注册表 ----------
const RANK_PROVIDERS = {
  wy: { ranks: neteaseRanks, songs: neteaseRankSongs },
  tx: { ranks: qqRanks, songs: qqRankSongs },
  kg: { ranks: kugouRanks, songs: kugouRankSongs },
}

export async function getAllRanks(): Promise<Rank[]> {
  const all = await Promise.allSettled(Object.values(RANK_PROVIDERS).map((p) => p.ranks()))
  const result: Rank[] = []
  for (const r of all) {
    if (r.status === 'fulfilled') result.push(...r.value)
  }
  return result
}

export async function getRankSongs(source: string, rankId: string, limit = 100): Promise<MusicInfo[]> {
  const provider = (RANK_PROVIDERS as any)[source]
  if (!provider) throw new Error(`unknown rank source: ${source}`)
  return provider.songs(rankId, limit)
}

export const RANK_SOURCES = ['wy', 'tx', 'kg']
