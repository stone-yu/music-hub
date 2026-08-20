/**
 * Navidrome (Subsonic API) 客户端
 *
 * 认证：salt(8位[a-z0-9]) + token=md5(password+salt)（password 在前），走 query 参数。
 * 端点统一 GET {url}/rest/{endpoint}，解析 subsonic-response.status==='ok'。
 * ping 单独 5s 超时快速反馈连接状态，其余 30s。
 *
 * getAllSongs 走 artist→album→song 三级遍历（非 search3），大库较慢但全量。
 */
import crypto from 'node:crypto'
import path from 'node:path'
import needle from 'needle'
import { config } from '../config.js'
import { logger } from '../logger.js'

export interface NavidromeSong {
  id: string
  title: string
  artist: string
  album: string
  coverArt?: string
  duration?: number
  suffix?: string
  playCount?: number
  created?: string  // ISO 时间戳，加入曲库时间（首页「新歌推荐」用）
}

const CLIENT_NAME = 'navidrome-ai-playlist'
const API_VERSION = '1.16.1'

class NavidromeClient {
  private baseUrl: string
  private user: string
  private password: string

  constructor() {
    this.baseUrl = config.navidrome.url.replace(/\/+$/, '')
    this.user = config.navidrome.user
    this.password = config.navidrome.password
  }

  private makeParams(extra: Record<string, string | string[]> = {}): Record<string, string | string[]> {
    const salt = Array.from(crypto.randomBytes(4))
      .map((b) => (b % 36).toString(36))
      .join('')
      .padEnd(8, '0')
    const token = crypto.createHash('md5').update(this.password + salt, 'utf8').digest('hex')
    return {
      u: this.user,
      t: token,
      s: salt,
      v: API_VERSION,
      c: CLIENT_NAME,
      f: 'json',
      ...extra,
    }
  }

  /** GET 通用请求，返回 subsonic-response（status=ok），失败返回 null */
  private async get(endpoint: string, extra?: Record<string, string | string[]>, timeout = 30_000): Promise<any | null> {
    const url = `${this.baseUrl}/rest/${endpoint}`
    try {
      const resp = await needle('get', url, this.makeParams(extra), {
        response_timeout: timeout,
        follow_max: 3,
        rejectUnauthorized: false,
      })
      const data = resp.body
      const response = data?.['subsonic-response']
      if (response?.status === 'ok') return response
      logger.warn({ endpoint, error: response?.error }, '[navidrome] API error')
      return null
    } catch (err) {
      logger.warn({ endpoint, err: (err as Error).message }, '[navidrome] request failed')
      return null
    }
  }

  async ping(): Promise<boolean> {
    const r = await this.get('ping', undefined, 5_000)
    return r !== null
  }

  async startScan(): Promise<boolean> {
    const r = await this.get('startScan')
    return r !== null
  }

  async getScanStatus(): Promise<{ scanning: boolean; count?: number; lastScan?: number }> {
    const r = await this.get('getScanStatus')
    if (!r) return { scanning: false }
    return r.scanStatus ?? { scanning: false }
  }

  async getArtists(): Promise<any[]> {
    const r = await this.get('getArtists')
    if (!r) return []
    const artists: any[] = []
    for (const index of r.artists?.index ?? []) {
      for (const artist of index.artist ?? []) artists.push(artist)
    }
    return artists
  }

  async getArtist(artistId: string): Promise<any | null> {
    return this.get('getArtist', { id: artistId })
  }

  async getAlbum(albumId: string): Promise<any | null> {
    return this.get('getAlbum', { id: albumId })
  }

  /** 全量歌曲：artist→album→song 三级遍历 */
  async getAllSongs(): Promise<NavidromeSong[]> {
    const artists = await this.getArtists()
    logger.info({ count: artists.length }, '[navidrome] fetching songs from artists')
    const songs: NavidromeSong[] = []
    for (let i = 0; i < artists.length; i++) {
      const artist = artists[i]
      const artistData = await this.getArtist(artist.id)
      if (!artistData?.artist) continue
      const artistName = artistData.artist.name ?? ''
      for (const album of artistData.artist.album ?? []) {
        const albumData = await this.getAlbum(album.id)
        if (!albumData?.album) continue
        for (const s of albumData.album.song ?? []) {
          songs.push({
            id: String(s.id ?? ''),
            title: s.title ?? '',
            artist: s.artist ?? artistName,
            album: s.album ?? album.name ?? '',
            coverArt: String(s.coverArt ?? albumData.album.coverArt ?? '') || undefined,
            duration: typeof s.duration === 'number' ? s.duration : undefined,
            suffix: typeof s.suffix === 'string' ? s.suffix : undefined,
            playCount: typeof s.playCount === 'number' ? s.playCount : undefined,
            created: typeof s.created === 'string' ? s.created : undefined,
          })
        }
      }
      if ((i + 1) % 20 === 0) logger.info({ done: i + 1, total: artists.length, songs: songs.length }, '[navidrome] progress')
    }
    logger.info({ count: songs.length }, '[navidrome] all songs fetched')
    return songs
  }

  async search3(query: string, count = 50): Promise<NavidromeSong[]> {
    const r = await this.get('search3', { query, songCount: String(count) })
    if (!r) return []
    return (r.searchResult3?.song ?? []).map((s: any) => ({
      id: String(s.id ?? ''),
      title: s.title ?? '',
      artist: s.artist ?? '',
      album: s.album ?? '',
      coverArt: String(s.coverArt ?? '') || undefined,
      duration: typeof s.duration === 'number' ? s.duration : undefined,
      suffix: typeof s.suffix === 'string' ? s.suffix : undefined,
      playCount: typeof s.playCount === 'number' ? s.playCount : undefined,
      created: typeof s.created === 'string' ? s.created : undefined,
    }))
  }

  async getPlaylists(): Promise<any[]> {
    const r = await this.get('getPlaylists')
    if (!r) return []
    return r.playlists?.playlist ?? []
  }

  async getPlaylist(playlistId: string): Promise<any | null> {
    return this.get('getPlaylist', { id: playlistId })
  }

  async deletePlaylist(playlistId: string): Promise<boolean> {
    const r = await this.get('deletePlaylist', { id: playlistId })
    return r !== null
  }

  /** 获取已收藏歌曲 id 集合（getStarred2 一次返回全部，供曲库歌曲页比对收藏状态） */
  async getStarredSongIds(): Promise<Set<string>> {
    const r = await this.get('getStarred2')
    const songs = r?.starred2?.song ?? []
    return new Set(songs.map((s: any) => String(s.id)))
  }

  /** 获取网络电台列表（广播电台功能用，Subsonic getInternetRadioStations） */
  async getInternetRadioStations(): Promise<{ id: string; name: string; streamUrl: string; homepageUrl?: string; coverArt?: string }[]> {
    const r = await this.get('getInternetRadioStations')
    if (!r) return []
    const stations = r.internetRadioStations?.internetRadioStation ?? []
    return stations.map((s: any) => ({
      id: String(s.id ?? ''),
      name: String(s.name ?? ''),
      streamUrl: String(s.streamUrl ?? ''),
      homepageUrl: s.homePageUrl ? String(s.homePageUrl) : undefined, // Subsonic 原始字段 homePageUrl(大写P)
      coverArt: s.coverArt ? String(s.coverArt) : undefined,
    })).filter((s: any) => s.streamUrl)
  }

  /** 创建网络电台（Subsonic createInternetRadioStation）。
   *  Subsonic 该接口不支持封面图参数，coverArt 无法通过 API 设置（Navidrome 后台可单独维护）。 */
  async createInternetRadioStation(streamUrl: string, name: string, homepageUrl?: string): Promise<boolean> {
    if (!streamUrl || !name) return false
    const extra: Record<string, string> = { streamUrl, name }
    if (homepageUrl) extra.homepageUrl = homepageUrl
    const r = await this.get('createInternetRadioStation', extra)
    return r !== null
  }

  /** 收藏歌曲 */
  async starSong(songId: string): Promise<boolean> {
    const r = await this.get('star', { id: songId })
    return r !== null
  }

  /** 取消收藏歌曲 */
  async unstarSong(songId: string): Promise<boolean> {
    const r = await this.get('unstar', { id: songId })
    return r !== null
  }

  /** 更新歌单：加歌(songIds)/改名(name)/改描述(comment)，可任意组合。
   *  走原生 fetch + URLSearchParams.append 重复 songIdToAdd：needle 在该 Navidrome 实例上
   *  对 updatePlaylist 会挂起（HTTP 层兼容问题），fetch 无此问题。 */
  async updatePlaylist(playlistId: string, opts: { songIds?: string[]; name?: string; comment?: string }): Promise<boolean> {
    const { songIds = [], name, comment } = opts
    if (!songIds.length && !name && !comment) return true
    const params = new URLSearchParams(this.makeParams({ playlistId }) as Record<string, string>)
    songIds.forEach((id) => params.append('songIdToAdd', id))
    if (name) params.set('name', name)
    if (comment !== undefined) params.set('comment', comment)
    const url = `${this.baseUrl}/rest/updatePlaylist?${params.toString()}`
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      const data = (await r.json().catch(() => null)) as any
      if (data?.['subsonic-response']?.status === 'ok') return true
      logger.warn({ error: data?.['subsonic-response']?.error }, '[navidrome] updatePlaylist API error')
      return false
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[navidrome] updatePlaylist failed')
      return false
    }
  }

  /** 从歌单移除单曲（Subsonic updatePlaylist 的 songIndexToRemove，按 0-based 索引） */
  async removePlaylistSong(playlistId: string, index: number): Promise<boolean> {
    const params = new URLSearchParams(this.makeParams({ playlistId }) as Record<string, string>)
    params.append('songIndexToRemove', String(index))
    const url = `${this.baseUrl}/rest/updatePlaylist?${params.toString()}`
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      const data = (await r.json().catch(() => null)) as any
      if (data?.['subsonic-response']?.status === 'ok') return true
      logger.warn({ error: data?.['subsonic-response']?.error }, '[navidrome] removePlaylistSong API error')
      return false
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[navidrome] removePlaylistSong failed')
      return false
    }
  }

  /**
   * 创建歌单。coverData 非空时走 POST multipart（字段名 coverArt），认证参数走 query string。
   * 创建后若 songIds/desc 非空，走 updatePlaylist 加歌 + 设 comment（Subsonic 创建接口无 desc 字段；
   * 加歌必须走 updatePlaylist，createPlaylist 内联 songId 在本实例不持久化）。
   * 返回 playlistId。
   */
  async createPlaylist(name: string, songIds: string[] = [], coverData?: Buffer, desc?: string): Promise<string | null> {
    const url = `${this.baseUrl}/rest/createPlaylist`
    const params = this.makeParams({ name })
    let playlistId: string | null = null
    try {
      if (coverData) {
        // multipart：认证参数拼到 URL query string，封面走 multipart 字段 coverArt
        const qs = new URLSearchParams(
          Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])),
        ).toString()
        const resp = await needle(
          'post',
          `${url}?${qs}`,
          { coverArt: { file: 'cover.jpg', content_type: 'image/jpeg', buffer: coverData } },
          {
            multipart: true,
            response_timeout: 30_000,
            rejectUnauthorized: false,
          },
        )
        const response = resp.body?.['subsonic-response']
        if (response?.status !== 'ok') {
          logger.warn({ error: response?.error }, '[navidrome] createPlaylist with cover failed')
          return null
        }
        playlistId = response.playlist?.id ? String(response.playlist.id) : null
      } else {
        const r = await this.get('createPlaylist', { name })
        if (!r) return null
        playlistId = r.playlist?.id ? String(r.playlist.id) : null
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[navidrome] createPlaylist failed')
      return null
    }
    // 加歌 + 设描述（comment），走 fetch 版 updatePlaylist（needle 对 updatePlaylist 会挂起）
    if (playlistId && (songIds.length || desc)) await this.updatePlaylist(playlistId, { songIds, comment: desc })
    return playlistId
  }

  async getCoverArt(coverId: string, size = 300): Promise<Buffer | null> {
    const url = `${this.baseUrl}/rest/getCoverArt`
    try {
      const resp = await needle('get', url, this.makeParams({ id: coverId, size: String(size) }), {
        response_timeout: 15_000,
        follow_max: 3,
        rejectUnauthorized: false,
      })
      const buf = resp.body as Buffer
      if (Buffer.isBuffer(buf) && buf.length > 100) return buf
      return null
    } catch {
      return null
    }
  }

  /**
   * 构造带鉴权的 stream 直链 URL（仅服务端 fetch 用，凭据不暴露给浏览器）。
   * subsonic stream 端点直接返回音频二进制，不走 subsonic-response 包装。
   */
  streamUrl(songId: string): string {
    const url = `${this.baseUrl}/rest/stream`
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(this.makeParams({ id: songId }))) {
      params.set(k, Array.isArray(v) ? String(v[0]) : String(v))
    }
    return `${url}?${params.toString()}`
  }

  /** 供 Phase 2 刮削用：触发扫描并轮询直到完成或超时 */
  async startScanAndWait(maxWaitMs = 120_000, pollIntervalMs = 3_000): Promise<void> {
    await this.startScan()
    const deadline = Date.now() + maxWaitMs
    while (Date.now() < deadline) {
      const { scanning } = await this.getScanStatus()
      if (!scanning) break
      await new Promise((r) => setTimeout(r, pollIntervalMs))
    }
  }
}

export const navidromeClient = new NavidromeClient()

// 保留 path import 供未来扩展（如本地文件路径处理），当前未直接使用
void path
