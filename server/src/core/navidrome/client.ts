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

  /** 加歌到已有歌单（去重由调用方处理） */
  async updatePlaylist(playlistId: string, songIds: string[]): Promise<boolean> {
    if (!songIds.length) return true
    const r = await this.get('updatePlaylist', { playlistId, songIdToAdd: songIds })
    return r !== null
  }

  /**
   * 创建歌单。coverData 非空时走 POST multipart（字段名 coverArt），
   * 认证参数走 query string。创建后若 songIds 非空再 updatePlaylist 加歌。
   * 返回 playlistId。
   */
  async createPlaylist(name: string, songIds: string[] = [], coverData?: Buffer): Promise<string | null> {
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
    if (playlistId && songIds.length) await this.updatePlaylist(playlistId, songIds)
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
