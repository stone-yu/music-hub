/**
 * Navidrome 曲库缓存 + 持久化
 *
 * 内存 {songs, lastUpdate, loading} + 磁盘 data/library_cache.json（原子写，只存 4 字段）。
 * CACHE_TTL=600s 懒加载；loading 守卫（boolean，并发丢弃不排队，finally 复位）。
 * scanFirst=true 先 startScan 轮询再 getAllSongs（刮削/手动刷新用）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT_DIR } from '../config.js'
import { logger } from '../logger.js'
import { navidromeClient, type NavidromeSong } from '../navidrome/client.js'
import { libMatchKey } from './match.js'

const CACHE_FILE = path.join(ROOT_DIR, 'data', 'library_cache.json')
const CACHE_TTL = 600_000 // 10 分钟

interface CacheState {
  songs: NavidromeSong[]
  lastUpdate: number
  loading: boolean
}

const state: CacheState = { songs: [], lastUpdate: 0, loading: false }

function loadFromDisk(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) return
    const raw = fs.readFileSync(CACHE_FILE, 'utf8')
    const data = JSON.parse(raw) as { songs: NavidromeSong[]; last_update?: number }
    state.songs = (data.songs ?? []).map((s) => ({
      id: String(s.id ?? ''),
      title: s.title ?? '',
      artist: s.artist ?? '',
      album: s.album ?? '',
      coverArt: s.coverArt ? String(s.coverArt) : undefined,
      duration: typeof s.duration === 'number' ? s.duration : undefined,
      suffix: typeof s.suffix === 'string' ? s.suffix : undefined,
      playCount: typeof s.playCount === 'number' ? s.playCount : undefined,
      created: typeof s.created === 'string' ? s.created : undefined,
    }))
    state.lastUpdate = data.last_update ?? 0
    logger.info(
      { count: state.songs.length, at: state.lastUpdate ? new Date(state.lastUpdate).toISOString() : 'never' },
      '[library] snapshot loaded from disk',
    )
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '[library] load snapshot failed')
  }
}

function saveToDisk(): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    const payload = {
      songs: state.songs.map((s) => ({ id: s.id, title: s.title, artist: s.artist, album: s.album, coverArt: s.coverArt, duration: s.duration, suffix: s.suffix, playCount: s.playCount, created: s.created })),
      last_update: state.lastUpdate,
    }
    const tmp = `${CACHE_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8')
    fs.renameSync(tmp, CACHE_FILE)
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '[library] save snapshot failed')
  }
}

/** 刷新曲库。scanFirst=true 先触发 Navidrome 扫描并等待完成。loading 守卫防重入。 */
function refresh(scanFirst: boolean): void {
  if (state.loading) return
  state.loading = true
  void (async () => {
    try {
      if (scanFirst) {
        logger.info('[library] scan-first: triggering Navidrome scan then reload')
        await navidromeClient.startScanAndWait(120_000, 3_000)
      }
      logger.info('[library] refreshing songs...')
      const songs = await navidromeClient.getAllSongs()
      state.songs = songs
      state.lastUpdate = Date.now()
      saveToDisk()
      logger.info({ count: songs.length }, '[library] refreshed')
    } catch (err) {
      logger.error({ err: (err as Error).message }, '[library] refresh failed')
    } finally {
      state.loading = false
    }
  })()
}

export const library = {
  init(): void {
    loadFromDisk()
    if (state.lastUpdate > 0) {
      // 有快照：后台异步刷新（不阻塞启动）
      refresh(false)
    }
  },

  /** 获取歌曲列表（TTL 懒加载，过期触发后台刷新） */
  getSongs(): NavidromeSong[] {
    if (Date.now() - state.lastUpdate > CACHE_TTL) refresh(false)
    return state.songs
  },

  /** 主动刷新，scanFirst=true 先扫描 */
  refresh(scanFirst = false): void {
    refresh(scanFirst)
  },

  /** {matchKey: song} 索引，首个胜出（重复 key 不覆盖） */
  getIndex(): Map<string, NavidromeSong> {
    const idx = new Map<string, NavidromeSong>()
    for (const s of state.songs) {
      const k = libMatchKey(s.title, s.artist)
      if (!idx.has(k)) idx.set(k, s)
    }
    return idx
  },

  getStatus(): { connected: boolean; size: number; loading: boolean; everLoaded: boolean } {
    return {
      connected: false, // 由路由层调 ping() 实时填
      size: state.songs.length,
      loading: state.loading,
      everLoaded: state.lastUpdate > 0,
    }
  },

  get lastUpdate(): number {
    return state.lastUpdate
  },
}
