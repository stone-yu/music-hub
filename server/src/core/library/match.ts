/**
 * 曲库匹配算法 — 严格复刻原 Python 实现（三套正则不对称，保留原有命中率）。
 *
 * 1. libMatchKey：库侧标准化键，去标点[\s\-\(\)（）\[\]【】「」《》] + 小写，
 *    title 去 feat/ft/合唱/对唱/live/remix/cover/翻唱/伴奏，artist 额外去 &/、/，
 *    拼 "title|artist"
 * 2. searchMatchKey：搜索侧，同上但 title 多去 dj.*版|完整版
 * 3. 模糊匹配：极简清理 [\s\-\(\)（）] 双向子串包含，长度≥2，O(n) 全库扫描
 *
 * 精确 matchKey 相等 O(1)；模糊遍历全库 O(n)。isFuzzy 编码进 source 后缀 "(模糊)"。
 */
import type { NavidromeSong } from '../navidrome/client.js'

const PUNCT = /[\s\-\(\)（）\[\]【】「」《》]/g
const TITLE_EXTRA_LIB = /feat\.?|ft\.?|合唱|对唱|live|remix|cover|翻唱|伴奏/g
const TITLE_EXTRA_SEARCH = /feat\.?|ft\.?|合唱|对唱|live|remix|cover|翻唱|伴奏|dj.*版|完整版/g
const ARTIST_EXTRA = /feat\.?|ft\.?|&|、|，/g
const FUZZY_STRIP = /[\s\-\(\)（）]/g

/** 库侧标准化键 */
export function libMatchKey(title: string, artist: string): string {
  const t = title.toLowerCase().replace(PUNCT, '').replace(TITLE_EXTRA_LIB, '')
  const a = artist.toLowerCase().replace(PUNCT, '').replace(ARTIST_EXTRA, '')
  return `${t}|${a}`
}

/** 搜索侧标准化键（title 多去 dj.*版|完整版） */
export function searchMatchKey(title: string, artist: string): string {
  const t = title.toLowerCase().replace(PUNCT, '').replace(TITLE_EXTRA_SEARCH, '')
  const a = artist.toLowerCase().replace(PUNCT, '').replace(ARTIST_EXTRA, '')
  return `${t}|${a}`
}

export interface MatchedSong {
  title: string
  artist: string
  album: string
  id: string
  source: string // 含 "(模糊)" 后缀表示模糊命中
}

export interface MatchInput {
  title: string
  artist: string
  source: string // 平台名
}

/** 单首匹配：精确 O(1) → 模糊 O(n) */
export function matchOne(
  song: MatchInput,
  libIndex: Map<string, NavidromeSong>,
): { matched: MatchedSong | null; isFuzzy: boolean } {
  const key = searchMatchKey(song.title, song.artist)
  const exact = libIndex.get(key)
  if (exact) {
    return {
      matched: {
        title: exact.title,
        artist: exact.artist,
        album: exact.album,
        id: exact.id,
        source: song.source,
      },
      isFuzzy: false,
    }
  }
  // 模糊：标题清理后双向子串包含
  const titleClean = song.title.toLowerCase().replace(FUZZY_STRIP, '')
  if (titleClean.length >= 2) {
    for (const ls of libIndex.values()) {
      const libTitle = ls.title.toLowerCase().replace(FUZZY_STRIP, '')
      if (libTitle && (titleClean.includes(libTitle) || libTitle.includes(titleClean))) {
        return {
          matched: {
            title: ls.title,
            artist: ls.artist,
            album: ls.album,
            id: ls.id,
            source: `${song.source}(模糊)`,
          },
          isFuzzy: true,
        }
      }
    }
  }
  return { matched: null, isFuzzy: false }
}

/** 批量匹配，按 lib_id 去重（同一首库歌只保留首次） */
export function matchSongs(
  songs: MatchInput[],
  libIndex: Map<string, NavidromeSong>,
): { matched: MatchedSong[]; unmatched: MatchInput[] } {
  const matched: MatchedSong[] = []
  const unmatched: MatchInput[] = []
  const seenLibIds = new Set<string>()
  for (const song of songs) {
    const { matched: m } = matchOne(song, libIndex)
    if (m) {
      if (seenLibIds.has(m.id)) continue
      seenLibIds.add(m.id)
      matched.push(m)
    } else {
      unmatched.push(song)
    }
  }
  return { matched, unmatched }
}
