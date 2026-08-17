/**
 * 跨平台歌曲匹配 — 移植自 lx-music-desktop@9c364b4
 *   src/renderer/utils/musicSdk/index.js 的 searchMusic + findMusic
 *
 * 用途：当某平台取 URL 失败时，用「名字+歌手+专辑+时长」在其它平台搜同一首歌，
 * 返回按匹配精度排序的候选列表（洛雪 getOtherSource 的核心）。
 *
 * 逐字段对齐上游：
 *   - filterStr 归一化（去空格/标点）后小写比较
 *   - sortSingle：多歌手按 localeCompare 排序后 join，消除顺序差异
 *   - 时长差 ≥5 秒一票否决（isEqualsInterval）
 *   - 三档匹配 + 9 级精度排序（sortMusic）
 */
import { searchService, ALL_PLATFORMS, type Platform } from '../search/index.js'
import type { MusicInfo } from './common.js'
import { logger } from '../logger.js'

export interface FindMusicQuery {
  name: string
  singer: string
  albumName?: string
  interval?: string | 0
  /** 源平台，搜索时排除它自身 */
  source: string
}

/** 带匹配中间字段的临时类型 */
type ScoredMusic = MusicInfo & {
  fSinger?: string
  fMusicName?: string
  fAlbumName?: string
  fInterval?: number
  _matchName?: string | null // 上游用 name=null 作淘汰标记，这里独立字段避免破坏原数据
}

const singersRxp = /、|&|;|；|\/|,|，|\|/
function sortSingle(singer: string): string {
  return singersRxp.test(singer)
    ? singer.split(singersRxp).sort((a, b) => a.localeCompare(b)).join('、')
    : (singer || '')
}

function getIntv(interval: string | 0 | undefined): number {
  if (!interval) return 0
  const intvArr = String(interval).split(':')
  let intv = 0
  let unit = 1
  while (intvArr.length) {
    intv += parseInt(intvArr.pop() as string) * unit
    unit *= 60
  }
  return intv
}

function trimStr(str: unknown): string {
  return typeof str === 'string' ? str.trim() : String(str ?? '')
}

// 上游 filterStr：去空格与各类标点后比较
function filterStr(str: unknown): string {
  return typeof str === 'string'
    ? str.replace(/\s|'|\.|,|，|&|"|、|\(|\)|（|）|`|~|-|<|>|\||\/|\]|\[|!|！/g, '')
    : String(str ?? '')
}

/**
 * 跨平台搜索：并发查除源平台外的所有平台。
 * 对齐上游 searchMusic：query = `${name} ${singer}`。
 */
async function searchMusic(query: FindMusicQuery): Promise<{ platform: Platform; list: MusicInfo[] }[]> {
  const keyword = `${trimStr(query.name)} ${query.singer || ''}`.trim()
  const targets = ALL_PLATFORMS.filter((p) => p !== query.source)
  const settled = await Promise.allSettled(
    targets.map((p) => searchService.searchPlatform(p, keyword, 1, 25)),
  )
  const out: { platform: Platform; list: MusicInfo[] }[] = []
  settled.forEach((s, i) => {
    const platform = targets[i]!
    if (s.status === 'fulfilled') out.push({ platform, list: s.value.list })
    else logger.warn({ platform, err: String(s.reason) }, '[match] search failed')
  })
  return out
}

/**
 * findMusic — 在其它平台找同一首歌，返回按精度排序的候选。
 * 完整移植上游 index.js findMusic。
 */
export async function findMusic(query: FindMusicQuery): Promise<MusicInfo[]> {
  const lists = await searchMusic(query)

  const fMusicName = filterStr(query.name).toLowerCase()
  const fSinger = filterStr(sortSingle(query.singer)).toLowerCase()
  const fAlbumName = filterStr(query.albumName ?? '').toLowerCase()
  const fInterval = getIntv(query.interval)

  const isEqualsInterval = (intv: number): boolean => Math.abs((fInterval || intv) - (intv || fInterval)) < 5
  const isIncludesName = (name: string): boolean => fMusicName.includes(name) || name.includes(fMusicName)
  const isIncludesSinger = (singer: string): boolean => (fSinger ? fSinger.includes(singer) || singer.includes(fSinger) : true)
  const isEqualsAlbum = (album: string): boolean => (fAlbumName ? fAlbumName === album : true)

  // 三档匹配：每个平台最多取一条最佳
  const result: ScoredMusic[] = []
  for (const src of lists) {
    const scored = src.list as ScoredMusic[]
    for (const item of scored) {
      item.name = trimStr(item.name)
      item.singer = trimStr(item.singer)
      item.fSinger = filterStr(sortSingle(item.singer).toLowerCase())
      item.fMusicName = filterStr(String(item.name ?? '').toLowerCase())
      item.fAlbumName = filterStr(String(item.albumName ?? '').toLowerCase())
      item.fInterval = getIntv(item.interval)
      item._matchName = item.name
    }
    let matched: ScoredMusic | null = null
    // 档1：时长过关 + 歌名完全相等 + 歌手包含
    for (const item of scored) {
      if (!isEqualsInterval(item.fInterval as number)) { item._matchName = null; continue }
      if (item.fMusicName === fMusicName && isIncludesSinger(item.fSinger as string)) { matched = item; break }
    }
    // 档2：歌手完全相等 + 歌名包含
    if (!matched) {
      for (const item of scored) {
        if (item._matchName == null) continue
        if (item.fSinger === fSinger && isIncludesName(item.fMusicName as string)) { matched = item; break }
      }
    }
    // 档3：专辑相等 + 歌手包含 + 歌名包含
    if (!matched) {
      for (const item of scored) {
        if (item._matchName == null) continue
        if (isEqualsAlbum(item.fAlbumName as string) && isIncludesSinger(item.fSinger as string) && isIncludesName(item.fMusicName as string)) { matched = item; break }
      }
    }
    if (matched) result.push(matched)
  }

  // 9 级精度排序：把最像的排前面
  const sortMusic = (arr: ScoredMusic[], cb: (i: ScoredMusic) => boolean): ScoredMusic[] => {
    const picked: ScoredMusic[] = []
    for (let i = arr.length - 1; i > -1; i--) {
      if (cb(arr[i]!)) { picked.push(arr[i]!); arr.splice(i, 1) }
    }
    picked.reverse()
    return picked
  }

  const newResult: ScoredMusic[] = []
  if (result.length) {
    newResult.push(...sortMusic(result, (i) => i.fSinger === fSinger && i.fMusicName === fMusicName && i.interval === query.interval))
    newResult.push(...sortMusic(result, (i) => i.fMusicName === fMusicName && i.fSinger === fSinger && i.fAlbumName === fAlbumName))
    newResult.push(...sortMusic(result, (i) => i.fSinger === fSinger && i.fMusicName === fMusicName))
    newResult.push(...sortMusic(result, (i) => i.fMusicName === fMusicName && i.interval === query.interval))
    newResult.push(...sortMusic(result, (i) => i.fSinger === fSinger && i.interval === query.interval))
    newResult.push(...sortMusic(result, (i) => i.interval === query.interval))
    newResult.push(...sortMusic(result, (i) => i.fMusicName === fMusicName))
    newResult.push(...sortMusic(result, (i) => i.fSinger === fSinger))
    newResult.push(...sortMusic(result, (i) => i.fAlbumName === fAlbumName))
    newResult.push(...result)
  }

  // 清理临时字段
  for (const item of newResult) {
    delete item.fSinger
    delete item.fMusicName
    delete item.fAlbumName
    delete item.fInterval
    delete item._matchName
  }
  return newResult
}
