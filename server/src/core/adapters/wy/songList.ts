/**
 * 网易云歌单适配器 — 移植自 lx-music-desktop@9c364b4 wy/songList.js
 *   search：eapi 搜歌单（type=1000）
 *   getListDetail：linuxapi 转发取歌单内歌曲
 * 简化：大歌单（trackIds 与 privileges 数量不一致）的二次补齐逻辑略去，
 *      仅返回 body.playlist.tracks 能直接给出的歌曲（个人自用足够）。
 */
import { httpFetch } from '../http.js'
import {
  formatPlayTime, sizeFormate, formatPlayCount, dateFormat,
  type MusicInfo, type MusicQualityType, type SongListItem, type SongListSearchResult, type SongListDetailResult,
} from '../common.js'
import { eapi, linuxapi, weapi } from './crypto.js'

const LIMIT_LIST = 30
const LIMIT_SONG = 100000
const SUCCESS = 200

function eapiRequest<T = any>(url: string, data: unknown) {
  return httpFetch<T>('http://interface.music.163.com/eapi/batch', {
    method: 'post',
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
      origin: 'https://music.163.com',
    },
    form: eapi(url, data),
  })
}

/** weapi song/detail 批量补齐（大歌单 tracks 不全时用 trackIds 拉取），每批 <=1000 */
async function getSongDetail(ids: number[]): Promise<{ songs: WyTrack[]; privileges: WyPrivilege[] }> {
  const { statusCode, body } = await httpFetch<{ code: number; songs: WyTrack[]; privileges: WyPrivilege[] }>(
    'https://music.163.com/weapi/v3/song/detail',
    {
      method: 'post',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
        origin: 'https://music.163.com',
      },
      form: weapi({
        c: '[' + ids.map((id) => '{"id":' + id + '}').join(',') + ']',
        ids: '[' + ids.join(',') + ']',
      }),
    },
  ).promise
  if (statusCode !== 200 || body.code !== SUCCESS) throw new Error('获取网易云歌曲详情失败')
  return { songs: body.songs ?? [], privileges: body.privileges ?? [] }
}

interface WyPlaylist {
  id: number
  name: string
  creator: { nickname: string }
  createTime?: number
  coverImgUrl: string
  trackCount: number
  description: string
  playCount: number
}
interface WyTrack {
  id: number
  name: string
  dt: number
  ar: { name: string }[]
  al: { name: string; id: number; picUrl: string }
  hr?: { size: number }
  sq?: { size: number }
  h?: { size: number }
  l?: { size: number }
}
interface WyPrivilege { id: number; maxBrLevel: string; maxbr: number }

function filterListDetail(tracks: WyTrack[], privileges: WyPrivilege[]): MusicInfo[] {
  const list: MusicInfo[] = []
  tracks.forEach((item, index) => {
    const types: MusicQualityType[] = []
    const _types: MusicInfo['_types'] = {}
    let priv = privileges[index]
    if (!priv || priv.id !== item.id) priv = privileges.find((p) => p.id === item.id) as WyPrivilege
    if (!priv) return
    let size: string | null
    if (priv.maxBrLevel === 'hires') {
      size = item.hr ? sizeFormate(item.hr.size) : null
      types.push({ type: 'flac24bit', size }); _types.flac24bit = { size }
    }
    // 上游 fall-through：高档补齐所有低档
    switch (priv.maxbr) {
      case 999000:
        size = item.sq ? sizeFormate(item.sq.size) : null
        types.push({ type: 'flac', size }); _types.flac = { size }
      // eslint-disable-next-line no-fallthrough
      case 320000:
        size = item.h ? sizeFormate(item.h.size) : null
        types.push({ type: '320k', size }); _types['320k'] = { size }
      // eslint-disable-next-line no-fallthrough
      case 192000:
      case 128000:
        size = item.l ? sizeFormate(item.l.size) : null
        types.push({ type: '128k', size }); _types['128k'] = { size }
    }
    types.reverse()
    list.push({
      singer: item.ar.map((a) => a.name).join('、'),
      name: item.name,
      albumName: item.al.name,
      albumId: item.al.id,
      source: 'wy',
      interval: formatPlayTime(item.dt / 1000),
      songmid: item.id,
      img: item.al.picUrl,
      lrc: null,
      otherSource: null,
      types,
      _types,
      typeUrl: {},
    })
  })
  return list
}

export default {
  async search(text: string, page = 1, limit = LIMIT_LIST): Promise<SongListSearchResult> {
    const { body } = await eapiRequest<{ code: number; result: { playlists: WyPlaylist[]; playlistCount: number } }>(
      '/api/cloudsearch/pc',
      { s: text, type: 1000, limit, total: page === 1, offset: limit * (page - 1) },
    ).promise
    if (body.code !== SUCCESS) throw new Error('搜索网易云歌单失败')
    const list: SongListItem[] = (body.result.playlists ?? []).map((item) => ({
      play_count: formatPlayCount(item.playCount),
      id: String(item.id),
      author: item.creator.nickname,
      name: item.name,
      time: dateFormat(item.createTime, 'Y-M-D'),
      img: item.coverImgUrl,
      total: item.trackCount,
      desc: item.description,
      source: 'wy',
    }))
    return { list, limit, total: body.result.playlistCount || list.length, source: 'wy' }
  },

  async getListDetail(id: string, page = 1): Promise<SongListDetailResult> {
    // 支持传入完整链接：抽取数字 id
    let listId = id
    const m = /(?:\?|&)id=(\d+)/.exec(id) ?? /\/playlist\/(\d+)/.exec(id)
    if (m) listId = m[1]!
    const { statusCode, body } = await httpFetch<{
      code: number
      playlist: WyPlaylist & { tracks: WyTrack[]; trackIds: { id: number }[] }
      privileges: WyPrivilege[]
    }>('https://music.163.com/api/linux/forward', {
      method: 'post',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
        Cookie: 'MUSIC_U=',
      },
      form: linuxapi({
        method: 'POST',
        url: 'https://music.163.com/api/v3/playlist/detail',
        params: { id: listId, n: LIMIT_SONG, s: 8 },
      }),
    }).promise
    if (statusCode !== 200 || body.code !== SUCCESS) throw new Error('获取网易云歌单详情失败')
    const tracks = body.playlist.tracks ?? []
    const trackIds = body.playlist.trackIds ?? []
    let list: MusicInfo[]
    if (trackIds.length && trackIds.length === (body.privileges ?? []).length) {
      // tracks 与 privileges 数量一致：直接用
      list = filterListDetail(tracks, body.privileges ?? [])
    } else if (trackIds.length > tracks.length) {
      // 大歌单 tracks 不全：按 trackIds 分批 weapi 补齐（每批 1000）
      const ids = trackIds.map((t) => t.id)
      const batches: number[][] = []
      for (let i = 0; i < ids.length; i += 1000) batches.push(ids.slice(i, i + 1000))
      const parts = await Promise.all(batches.map(async (b) => {
        const { songs, privileges } = await getSongDetail(b)
        return filterListDetail(songs, privileges)
      }))
      list = parts.flat()
    } else {
      list = filterListDetail(tracks, body.privileges ?? [])
    }
    return {
      list,
      page,
      limit: LIMIT_SONG,
      total: trackIds.length || list.length,
      source: 'wy',
      info: {
        play_count: formatPlayCount(body.playlist.playCount),
        name: body.playlist.name,
        img: body.playlist.coverImgUrl,
        desc: body.playlist.description,
        author: body.playlist.creator.nickname,
      },
    }
  },
}
