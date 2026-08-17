/**
 * 上游 musicSdk 公共工具的服务端版
 * 对应 src/renderer/utils/index.js 中被适配器引用的函数
 */

/** HTML 实体解码（上游 decodeName） */
const encodeNames: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#039;': "'",
}
export function decodeName(str: string | null | undefined): string {
  return str?.replace(/(?:&amp;|&lt;|&gt;|&quot;|&apos;|&#039;|&nbsp;)/gm, (s) => encodeNames[s] ?? s) ?? ''
}

/** 秒 → mm:ss（上游 formatPlayTime） */
export function formatPlayTime(time: number): string {
  const m = Math.trunc(time / 60)
  const s = Math.trunc(time % 60)
  return m === 0 && s === 0 ? '--/--' : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 字节数 → 可读大小（上游 sizeFormate） */
export function sizeFormate(size: number): string {
  if (!size) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const number = Math.floor(Math.log(size) / Math.log(1024))
  return `${(size / Math.pow(1024, number)).toFixed(2)} ${units[number]}`
}

/** 播放量格式化（上游各平台 formatPlayCount 统一版：亿/万） */
export function formatPlayCount(num: number | string | undefined | null): number | string {
  const n = typeof num === 'number' ? num : parseInt(String(num ?? ''))
  if (isNaN(n)) return num ?? 0
  if (n > 100000000) return Math.trunc(n / 10000000) / 10 + '亿'
  if (n > 10000) return Math.trunc(n / 1000) / 10 + '万'
  return n
}

/** 时间戳/秒 → 日期字符串（上游 dateFormat 简化版，仅支持 Y-M-D） */
export function dateFormat(input: number | string | undefined | null, _fmt = 'Y-M-D'): string {
  if (!input) return ''
  let ts = typeof input === 'number' ? input : parseInt(String(input))
  if (isNaN(ts)) return ''
  if (ts < 1e12) ts *= 1000 // 秒 → 毫秒
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const M = String(d.getMonth() + 1).padStart(2, '0')
  const D = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${M}-${D}`
}

/**
 * 酷我畸形 JSON 修复（上游 kw/util.js objStr2JSON）：
 * 把单引号包裹的对象字符串转成合法 JSON。
 */
export function objStr2JSON<T = unknown>(str: string): T {
  return JSON.parse(str.replace(/('(?=(,\s*')))|('(?=:))|((?<=([:,]\s*))')|((?<={)')|('(?=}))/g, '"')) as T
}

export interface MusicQualityType {
  type: '128k' | '320k' | 'flac' | 'flac24bit'
  size?: string | null
}

/** 统一的搜索结果歌曲结构（与上游各平台 handleResult 产出对齐） */
export interface MusicInfo {
  name: string
  singer: string
  source: string
  songmid: string | number
  albumId?: string | number
  albumName?: string
  interval?: string | 0
  img?: string | null
  lrc?: string | null
  types: MusicQualityType[]
  _types: Record<string, { size?: string | null } | undefined>
  typeUrl?: Record<string, string>
  hash?: string // kg 专用
  strMediaMid?: string // tx 专用
  albumMid?: string // tx 专用
  copyrightId?: string // mg 专用
  lrcUrl?: string // mg 专用
  mrcUrl?: string
  trcUrl?: string
  otherSource?: null
}

export interface SearchResult {
  list: MusicInfo[]
  allPage: number
  total: number
  limit: number
  source: string
}

/** 歌单搜索结果项（上游 songList.search 产出对齐） */
export interface SongListItem {
  id: string
  name: string
  author: string
  img?: string | null
  desc?: string | null
  total?: number // 歌曲数
  play_count?: number | string
  time?: string
  source: string
}

export interface SongListSearchResult {
  list: SongListItem[]
  total: number
  limit: number
  source: string
}

/** 歌单详情（含歌曲列表，歌曲结构复用 MusicInfo，可直接下载） */
export interface SongListDetailResult {
  list: MusicInfo[]
  page: number
  limit: number
  total: number
  source: string
  info: {
    name?: string
    img?: string | null
    desc?: string | null
    author?: string
    play_count?: number | string
  }
}
