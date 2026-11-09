import type { Platform } from '../search/index.js'

/** Extract playlist IDs without requesting arbitrary URLs. */
export function parseShareUrl(input: string): { platform: Platform; id: string } | null {
  for (const link of input.match(/https?:\/\/[^\s<>"'，。！？、）】》]+/gi) ?? []) {
    let url: URL
    try { url = new URL(link.replace(/[),.;!?]+$/, '')) } catch { continue }
    if (url.username || url.password || url.port) continue
    const host = url.hostname.toLowerCase()
    const at = (domain: string) => host === domain || host.endsWith(`.${domain}`)
    const page = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url.origin) : url
    const path = page.pathname
    const numeric = (v: string | null | undefined) => v && /^[1-9]\d*$/.test(v) ? v : null
    let platform: Platform | undefined
    let id: string | null | undefined
    if (at('music.163.com') && /^\/(?:m\/)?playlist\/?$/.test(path)) {
      platform = 'wy'; id = numeric(page.searchParams.get('id'))
    } else if (at('y.qq.com')) {
      platform = 'tx'
      id = numeric(path.match(/^\/n\/(?:ryqq\/playlist|yqq\/playsquare)\/(\d+)(?:\.html)?\/?$/)?.[1])
      if (!id && /^\/(?:n\/m\/detail\/taoge\/index\.html|music\/common\/upload\/t_playsquare\/index\.html)$/.test(path)) id = numeric(page.searchParams.get('id'))
    } else if (at('kugou.com')) {
      platform = 'kg'
      id = numeric(path.match(/^\/(?:yy\/)?special\/single\/(\d+)(?:\.html)?\/?$/)?.[1] ?? path.match(/^\/special\/(\d+)(?:\.html)?\/?$/)?.[1] ?? path.match(/^\/speciallist\/single\/[^/]*-id-(\d+)\.html$/)?.[1])
    } else if (at('kuwo.cn')) {
      platform = 'kw'; id = numeric(path.match(/^\/(?:play_detail|playlist_detail)\/(\d+)\/?$/)?.[1])
    } else if (at('migu.cn')) {
      platform = 'mg'; id = path.match(/^\/(?:v3\/music\/)?playlist\/([A-Za-z0-9_-]+)\/?$/)?.[1]
    }
    if (platform && id) return { platform, id }
  }
  return null
}

/** Expand NetEase share links, validating each redirect before any request. */
export async function resolveShareUrl(input: string, request: typeof fetch = fetch) {
  const direct = parseShareUrl(input)
  if (direct) return direct
  const links = input.match(/https?:\/\/[^\s<>"'，。！？、）】》]+/gi) ?? []
  for (const link of links) {
    let url: URL
    try { url = new URL(link.replace(/[),.;!?]+$/, '')) } catch { continue }
    if (url.hostname !== '163cn.tv') continue
    const visited = new Set<string>()
    for (let hop = 0; hop < 5; hop++) {
      if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== '163cn.tv' || url.port || url.username || url.password) {
        throw new Error('歌单短链接跳转地址不受支持')
      }
      url.protocol = 'https:'
      if (visited.has(url.href)) throw new Error('歌单短链接存在循环跳转')
      visited.add(url.href)
      let response: Response
      try {
        response = await request(url.href, { redirect: 'manual', signal: AbortSignal.timeout(8000) })
      } catch {
        throw new Error('歌单短链接展开失败，请稍后重试或粘贴完整链接')
      }
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
        throw new Error('歌单短链接已失效或未返回跳转地址')
      }
      try { url = new URL(location, url) } catch { throw new Error('歌单短链接返回了无效跳转地址') }
      const parsed = parseShareUrl(url.href)
      if (parsed) return parsed
    }
    throw new Error('歌单短链接跳转次数过多')
  }
  return null
}
