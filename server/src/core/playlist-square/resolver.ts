/**
 * 歌单广场 + URL 解析
 *
 * 复用 ro 的 searchService.searchSongListAggregate（按关键词搜歌单）+ getSongListDetail（取详情）。
 * 广场预设几个热门关键词（经典/流行/华语/怀旧），并发搜各平台歌单。
 * resolveUrl 解析 5 平台分享 URL → platform+id → getSongListDetail。
 */
import { searchService, ALL_PLATFORMS, isPlatform, type Platform } from '../search/index.js'
import type { SongListItem } from '../adapters/common.js'

// 广场预设关键词（用户也可自己搜）
const SQUARE_KEYWORDS = ['经典', '流行', '华语', '怀旧']

export const playlistSquare = {
  /** 按关键词搜歌单（不指定平台则全平台聚合） */
  async search(keyword: string, platforms?: Platform[]) {
    const targets = platforms?.length ? platforms : ALL_PLATFORMS
    return searchService.searchSongListAggregate(keyword, 1, targets)
  },

  /** 广场：并发用预设关键词搜各平台歌单，扁平化返回 */
  async hot(platform?: Platform): Promise<{ keyword: string; items: SongListItem[] }[]> {
    const targets = platform ? [platform] : ALL_PLATFORMS
    const results: { keyword: string; items: SongListItem[] }[] = []
    for (const kw of SQUARE_KEYWORDS) {
      const agg = await searchService.searchSongListAggregate(kw, 1, targets)
      const items: SongListItem[] = []
      for (const r of agg.results) {
        if (r.ok) for (const item of r.list) items.push(item)
      }
      // 每个关键词最多取 12 个，避免过多
      results.push({ keyword: kw, items: items.slice(0, 12) })
    }
    return results
  },

  /** 解析分享 URL → 歌单详情（含歌曲列表，可直接下载） */
  async resolveUrl(url: string) {
    const parsed = parseShareUrl(url)
    if (!parsed) throw new Error('无法识别的歌单 URL，支持网易云/QQ/酷狗/酷我/咪咕')
    const detail = await searchService.getSongListDetail(parsed.platform, parsed.id)
    return { platform: parsed.platform, id: parsed.id, detail }
  },

  /** 直接按 platform+id 取歌单详情（广场卡片点击用） */
  async getDetail(platform: Platform, id: string) {
    return searchService.getSongListDetail(platform, id)
  },
}

/** 解析 5 平台歌单分享 URL → {platform, id} */
export function parseShareUrl(url: string): { platform: Platform; id: string } | null {
  // 网易云：music.163.com/playlist?id=123 或 #/playlist?id=123
  let m = url.match(/music\.163\.com.*?[?&#]id=(\d+)/)
  if (m) return { platform: 'wy', id: m[1]! }

  // QQ：y.qq.com/n/ryqq/playlist/{id}
  m = url.match(/y\.qq\.com\/n\/ryqq\/playlist\/([A-Za-z0-9]+)/)
  if (m) return { platform: 'tx', id: m[1]! }

  // 酷狗：kugou.com/speciallist/single/xxx-id-123.html 或 special/123.html
  m = url.match(/kugou\.com\/.*?special\/?(\d+)/) || url.match(/kugou\.com\/.*?-id-(\d+)/)
  if (m) return { platform: 'kg', id: m[1]! }

  // 酷我：kuwo.cn/play_detail/123 或 playlist_detail/123
  m = url.match(/kuwo\.cn\/.*?detail\/?(\d+)/)
  if (m) return { platform: 'kw', id: m[1]! }

  // 咪咕：migu.cn/playlist/xxx 或 music.migu.cn/v3/music/playlist/xxx
  m = url.match(/migu\.cn\/.*?playlist\/?([A-Za-z0-9_\-]+)/)
  if (m) return { platform: 'mg', id: m[1]! }

  return null
}

export { isPlatform, ALL_PLATFORMS }
