/**
 * radio5.cn 抓取/API 客户端
 *
 * 数据链路（已实测验证）：
 *  - 电台列表：分类页 https://radio5.cn/{path} 是 SSR HTML，每个电台条目同时带
 *    post-XXXX(数字id) + data-url=".../play/radio/{slug}" + 封面 + 标题，正则解析。
 *  - 取流：GET https://radio5.cn/api/play/play/{数字id}，仅需 Referer 头，返回 stream_url(m3u8)。
 *    key 时效鉴权，每次调用返回新 key，故 streamUrl 不缓存。
 *  - 搜索：GET https://radio5.cn/api/play/search?s={kw}，返回 [{title,url(含slug),thumbnail}]。
 *  - slug→id：抓 https://radio5.cn/play/radio/{slug} 取 body class 的 postid-XXXX。post id 稳定，长缓存。
 *
 * 缓存：分类列表内存缓存 10 分钟；slug→id 映射长缓存（随进程生命周期）；streamUrl 不缓存。
 */
import needle from 'needle'
import { logger } from '../logger.js'

const BASE = 'https://radio5.cn'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

export interface RadioStation {
  id: string        // 数字 post id（搜索结果无 id 时为空串）
  slug: string      // URL slug（如 cnr-zgzs）
  name: string      // 电台名
  cover: string     // 封面完整 URL（已补全域名）
  artist?: string   // 机构（能解析到则填）
}

export interface RadioStream {
  streamUrl: string  // m3u8 直播流地址（带时效 key）
  title: string
  cover: string
  artist: string
  isHls: true
}

// 分类列表缓存：path → { list, ts }
const stationCache = new Map<string, { list: RadioStation[]; ts: number }>()
const STATION_TTL = 10 * 60 * 1000

// slug → 数字 post id，长缓存
const slugIdCache = new Map<string, string>()

/** 通用 needle GET，返回 HTML 字符串或 JSON 对象 */
async function fetchText(pathOrUrl: string, timeout = 20_000): Promise<string> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}/${pathOrUrl}`
  const resp = await needle('get', url, null, {
    response_timeout: timeout,
    follow_max: 3,
    rejectUnauthorized: false,
    headers: { 'User-Agent': UA, Referer: BASE + '/' },
  })
  return typeof resp.body === 'string' ? resp.body : String(resp.body ?? '')
}

async function fetchJson(pathOrUrl: string, timeout = 15_000): Promise<any> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}/${pathOrUrl}`
  const resp = await needle('get', url, null, {
    response_timeout: timeout,
    follow_max: 3,
    rejectUnauthorized: false,
    json: true,
    headers: { 'User-Agent': UA, Referer: BASE + '/' },
  })
  return resp.body
}

/** 补全为完整 URL（radio5 内部相对路径以 / 开头） */
function absUrl(u: string): string {
  if (!u) return ''
  if (u.startsWith('http')) return u
  if (u.startsWith('//')) return 'https:' + u
  if (u.startsWith('/')) return BASE + u
  return BASE + '/' + u
}

class Radio5Client {
  /**
   * 按分类路径抓取电台列表。
   * 正则解析每个 post-XXXX 容器内的 data-url(slug) + img(封面) + 标题。
   */
  async getStationsByCategory(path: string): Promise<RadioStation[]> {
    const cached = stationCache.get(path)
    if (cached && Date.now() - cached.ts < STATION_TTL) return cached.list
    try {
      const html = await fetchText(path)
      const list = parseStationList(html)
      stationCache.set(path, { list, ts: Date.now() })
      return list
    } catch (err) {
      logger.warn({ path, err: (err as Error).message }, '[radio5] getStationsByCategory failed')
      return []
    }
  }

  /** 全站搜索电台 */
  async searchStations(q: string): Promise<RadioStation[]> {
    if (!q?.trim()) return []
    try {
      const data = await fetchJson(`/api/play/search?s=${encodeURIComponent(q.trim())}`)
      if (!Array.isArray(data)) return []
      return data.map((it: any): RadioStation => {
        const slug = extractSlug(it.url)
        // thumbnail 是 <img src="...">，提取 src
        const coverMatch = String(it.thumbnail || '').match(/src="([^"]+)"/)
        return {
          id: '',
          slug,
          name: String(it.title || '').trim(),
          cover: absUrl(coverMatch ? coverMatch[1] : ''),
          artist: '',
        }
      }).filter((s: RadioStation) => s.slug && s.name)
    } catch (err) {
      logger.warn({ q, err: (err as Error).message }, '[radio5] searchStations failed')
      return []
    }
  }

  /**
   * 取播放流：slug → 数字id → /api/play/play/{id} → stream_url
   * streamUrl 含时效 key，每次现取，不缓存。
   */
  async getStream(slug: string): Promise<RadioStream | null> {
    const id = await this.resolveId(slug)
    if (!id) return null
    try {
      const data = await fetchJson(`/api/play/play/${id}`)
      if (!data?.stream_url) {
        logger.warn({ slug, id }, '[radio5] getStream no stream_url')
        return null
      }
      return {
        streamUrl: String(data.stream_url),
        title: String(data.title || ''),
        cover: absUrl(String(data.artwork_url || '')),
        artist: String(data.artist || ''),
        isHls: true,
      }
    } catch (err) {
      logger.warn({ slug, id, err: (err as Error).message }, '[radio5] getStream failed')
      return null
    }
  }

  /** slug → 数字 post id，优先长缓存，未命中抓播放页解析 body class 的 postid-XXXX */
  private async resolveId(slug: string): Promise<string | null> {
    const cached = slugIdCache.get(slug)
    if (cached) return cached
    try {
      const html = await fetchText(`/play/radio/${slug}`)
      const m = html.match(/postid-(\d+)/)
      if (m) {
        slugIdCache.set(slug, m[1]!)
        return m[1]!
      }
      logger.warn({ slug }, '[radio5] resolveId no postid found')
      return null
    } catch (err) {
      logger.warn({ slug, err: (err as Error).message }, '[radio5] resolveId failed')
      return null
    }
  }
}

/** 从列表页 HTML 解析电台条目 */
function parseStationList(html: string): RadioStation[] {
  const list: RadioStation[] = []
  // 匹配 post-XXXX 容器块（radio5 列表项 class 含 post-数字）
  const blockRe = /post-(\d+)[\s\S]*?(?=post-\d+|<\/(?:main|section|div)\s+class="(?:site|main)|$)/g
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = blockRe.exec(html)) !== null) {
    const block = blockMatch[0]
    const id = blockMatch[1]!
    // data-url="https://radio5.cn/play/radio/{slug}"
    const urlMatch = block.match(/data-url="https:\/\/radio5\.cn\/play\/radio\/([^"\/]+)"/)
    if (!urlMatch) continue
    const slug = urlMatch[1]!
    // 封面：<img ... src="..."> 取第一个 src
    const imgMatch = block.match(/<img[^>]+src="([^"]+)"/)
    const cover = absUrl(imgMatch ? imgMatch[1] : '')
    // 标题：优先 alt，其次 title 文本节点
    const altMatch = block.match(/alt="([^"]+)"/)
    const titleMatch = block.match(/<h[2-4][^>]*>([^<]+)<\/h[2-4]>/)
    const name = (altMatch ? altMatch[1] : titleMatch ? titleMatch[1] : '').trim()
    if (slug && name) {
      list.push({ id, slug, name, cover, artist: '' })
    }
  }
  return list
}

/** 从 url（如 https://radio5.cn/play/radio/cnr-zgzs）提取 slug */
function extractSlug(url: string): string {
  const m = String(url || '').match(/\/play\/radio\/([^"\/]+)/)
  return m ? m[1]! : ''
}

export const radio5Client = new Radio5Client()
