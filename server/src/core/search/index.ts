/**
 * SearchService — 统一 5 平台搜索适配器
 * - searchPlatform: 单平台搜索
 * - searchAggregate: 并发查所有(或指定)平台，合并结果（不跨平台去重，保留各平台来源）
 */
import kw from '../adapters/kw/musicSearch.js'
import kg from '../adapters/kg/musicSearch.js'
import tx from '../adapters/tx/musicSearch.js'
import wy from '../adapters/wy/musicSearch.js'
import mg from '../adapters/mg/musicSearch.js'
import kwSongList from '../adapters/kw/songList.js'
import kgSongList from '../adapters/kg/songList.js'
import txSongList from '../adapters/tx/songList.js'
import wySongList from '../adapters/wy/songList.js'
import mgSongList from '../adapters/mg/songList.js'
import type { SearchResult, MusicInfo, SongListSearchResult, SongListDetailResult } from '../adapters/common.js'
import { logger } from '../logger.js'

export type Platform = 'kw' | 'kg' | 'tx' | 'wy' | 'mg'

interface SearchAdapter {
  search(str: string, page?: number, limit?: number): Promise<SearchResult>
}

const ADAPTERS: Record<Platform, SearchAdapter> = { kw, kg, tx, wy, mg }

interface SongListAdapter {
  search(text: string, page?: number, limit?: number): Promise<SongListSearchResult>
  getListDetail(id: string, page?: number): Promise<SongListDetailResult>
}
const SONGLIST_ADAPTERS: Record<Platform, SongListAdapter> = {
  kw: kwSongList, kg: kgSongList, tx: txSongList, wy: wySongList, mg: mgSongList,
}
export const ALL_PLATFORMS: Platform[] = ['kw', 'kg', 'tx', 'wy', 'mg']

export function isPlatform(p: string): p is Platform {
  return (ALL_PLATFORMS as string[]).includes(p)
}

export interface AggregatePlatformResult {
  platform: Platform
  ok: boolean
  total: number
  list: MusicInfo[]
  error?: string
}

export interface AggregateSearchResult {
  keyword: string
  page: number
  results: AggregatePlatformResult[]
}

export const searchService = {
  async searchPlatform(platform: Platform, keyword: string, page = 1, limit?: number): Promise<SearchResult> {
    const adapter = ADAPTERS[platform]
    return adapter.search(keyword, page, limit)
  },

  /** 并发查询多个平台；单平台失败不影响其它平台（容错聚合） */
  async searchAggregate(keyword: string, page = 1, platforms: Platform[] = ALL_PLATFORMS, limit?: number): Promise<AggregateSearchResult> {
    const settled = await Promise.allSettled(
      platforms.map((p) => ADAPTERS[p].search(keyword, page, limit)),
    )
    const results: AggregatePlatformResult[] = settled.map((s, i) => {
      const platform = platforms[i]!
      if (s.status === 'fulfilled') {
        return { platform, ok: true, total: s.value.total, list: s.value.list }
      }
      const error = s.reason instanceof Error ? s.reason.message : String(s.reason)
      logger.warn(`[search] ${platform} failed: ${error}`)
      return { platform, ok: false, total: 0, list: [], error }
    })
    return { keyword, page, results }
  },

  async searchSongList(platform: Platform, keyword: string, page = 1, limit?: number): Promise<SongListSearchResult> {
    return SONGLIST_ADAPTERS[platform].search(keyword, page, limit)
  },

  async searchSongListAggregate(keyword: string, page = 1, platforms: Platform[] = ALL_PLATFORMS, limit?: number): Promise<{ keyword: string; page: number; results: Array<{ platform: Platform; ok: boolean; total: number; list: SongListSearchResult['list']; error?: string }> }> {
    const settled = await Promise.allSettled(
      platforms.map((p) => SONGLIST_ADAPTERS[p].search(keyword, page, limit)),
    )
    const results = settled.map((s, i) => {
      const platform = platforms[i]!
      if (s.status === 'fulfilled') {
        return { platform, ok: true, total: s.value.total, list: s.value.list }
      }
      const error = s.reason instanceof Error ? s.reason.message : String(s.reason)
      logger.warn(`[songlist] ${platform} failed: ${error}`)
      return { platform, ok: false, total: 0, list: [] as SongListSearchResult['list'], error }
    })
    return { keyword, page, results }
  },

  async getSongListDetail(platform: Platform, id: string, page = 1): Promise<SongListDetailResult> {
    return SONGLIST_ADAPTERS[platform].getListDetail(id, page)
  },
}
