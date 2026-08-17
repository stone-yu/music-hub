/**
 * 酷狗搜索适配器 — 移植自上游 src/renderer/utils/musicSdk/kg/musicSearch.js@9c364b4
 * 结构与上游保持对齐，便于跟随上游修复
 */
import { httpFetch } from '../http.js'
import { decodeName, formatPlayTime, sizeFormate, type MusicInfo, type MusicQualityType, type SearchResult } from '../common.js'

/** 上游 kg/utils formatSingerName 简化版（数组对象取 name 字段拼接） */
function formatSingerName(singers: unknown, nameKey = 'name'): string {
  if (Array.isArray(singers)) {
    return singers
      .map((s) => (typeof s === 'object' && s !== null ? String((s as Record<string, unknown>)[nameKey] ?? '') : String(s)))
      .filter(Boolean)
      .join('、')
  }
  return String(singers ?? '')
}

interface KgRawItem {
  Audioid: number | string
  FileHash: string
  SongName: string
  Singers?: { name: string }[]
  SingerName?: string
  AlbumName: string
  AlbumID: string | number
  Duration: number
  FileSize: number
  HQFileSize: number
  HQFileHash: string
  SQFileSize: number
  SQFileHash: string
  ResFileSize: number
  ResFileHash: string
  Grp?: KgRawItem[]
}

export default {
  limit: 30,

  musicSearch(str: string, page: number, limit: number) {
    const url = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(str)}&page=${page}&pagesize=${limit}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`
    return httpFetch<{ error_code: number; data: { total: number; lists: KgRawItem[] } }>(url).promise.then(({ body }) => body)
  },

  filterData(rawData: KgRawItem): MusicInfo {
    const types: MusicQualityType[] = []
    const _types: MusicInfo['_types'] = {}
    if (rawData.FileSize !== 0) {
      const size = sizeFormate(rawData.FileSize)
      types.push({ type: '128k', size })
      _types['128k'] = { size, hash: rawData.FileHash } as never
    }
    if (rawData.HQFileSize !== 0) {
      const size = sizeFormate(rawData.HQFileSize)
      types.push({ type: '320k', size })
      _types['320k'] = { size, hash: rawData.HQFileHash } as never
    }
    if (rawData.SQFileSize !== 0) {
      const size = sizeFormate(rawData.SQFileSize)
      types.push({ type: 'flac', size })
      _types.flac = { size, hash: rawData.SQFileHash } as never
    }
    if (rawData.ResFileSize !== 0) {
      const size = sizeFormate(rawData.ResFileSize)
      types.push({ type: 'flac24bit', size })
      _types.flac24bit = { size, hash: rawData.ResFileHash } as never
    }
    return {
      singer: decodeName(rawData.Singers ? formatSingerName(rawData.Singers) : (rawData.SingerName ?? '')),
      name: decodeName(rawData.SongName),
      albumName: decodeName(rawData.AlbumName),
      albumId: rawData.AlbumID,
      songmid: rawData.Audioid,
      source: 'kg',
      interval: formatPlayTime(rawData.Duration),
      img: null,
      lrc: null,
      otherSource: null,
      hash: rawData.FileHash,
      types,
      _types,
      typeUrl: {},
    }
  },

  handleResult(rawData: KgRawItem[]): MusicInfo[] {
    const ids = new Set<string>()
    const list: MusicInfo[] = []
    for (const item of rawData) {
      const key = String(item.Audioid) + item.FileHash
      if (ids.has(key)) continue
      ids.add(key)
      list.push(this.filterData(item))
      for (const childItem of item.Grp ?? []) {
        const childKey = String(childItem.Audioid) + childItem.FileHash
        if (ids.has(childKey)) continue
        ids.add(childKey)
        list.push(this.filterData(childItem))
      }
    }
    return list
  },

  async search(str: string, page = 1, limit?: number, retryNum = 0): Promise<SearchResult> {
    limit ??= this.limit
    if (retryNum > 3) throw new Error('try max num')
    const result = await this.musicSearch(str, page, limit)
    if (!result || result.error_code !== 0) return this.search(str, page, limit, retryNum + 1)
    const list = this.handleResult(result.data.lists)
    if (list == null) return this.search(str, page, limit, retryNum + 1)
    const total = result.data.total
    return {
      list,
      allPage: Math.ceil(total / limit),
      total,
      limit,
      source: 'kg',
    }
  },
}
