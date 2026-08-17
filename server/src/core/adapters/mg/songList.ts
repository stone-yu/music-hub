/**
 * 咪咕歌单适配器 — 移植自 lx-music-desktop@9c364b4 mg/songList.js
 *   search：searchAll（songlist=1）搜歌单
 *   getListDetail：playlist/song/v2.0 取歌曲 + playlist/v2.0 取歌单信息
 */
import { httpFetch } from '../http.js'
import {
  formatPlayTime, sizeFormate, formatPlayCount,
  type MusicInfo, type MusicQualityType, type SongListItem, type SongListSearchResult, type SongListDetailResult,
} from '../common.js'
import { createSignature } from './musicSearch.js'

const PAGE_SIZE = 50 // 咪咕服务端单页上限
const MAX_PAGES = 40 // 安全上限，避免超大歌单无限翻页
const SUCCESS = '000000'

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
  Referer: 'https://m.music.migu.cn/',
}

function formatSingerName(singerList: { name?: string }[] | undefined): string {
  if (!Array.isArray(singerList)) return ''
  return singerList.map((s) => s.name ?? '').filter(Boolean).join('、')
}

interface MgSongListRaw { id?: string; playNum?: string; userName?: string; name?: string; musicListPicUrl?: string; musicNum?: number }
interface MgAudioFormat { formatType: string; size?: number; androidSize?: number }
interface MgDetailSong {
  songId?: string; copyrightId?: string; songName: string; album?: string; albumId?: string | number
  duration: number; singerList?: { name?: string }[]; audioFormats?: MgAudioFormat[]
  img1?: string; img2?: string; img3?: string; lrcUrl?: string; mrcUrl?: string; trcUrl?: string
}

function filterMusicInfoListV5(rawList: MgDetailSong[]): MusicInfo[] {
  const ids = new Set<string>()
  const list: MusicInfo[] = []
  for (const item of rawList) {
    if (!item.songId || ids.has(item.songId)) continue
    ids.add(item.songId)
    const types: MusicQualityType[] = []
    const _types: MusicInfo['_types'] = {}
    for (const type of item.audioFormats ?? []) {
      const size = sizeFormate(type.size ?? type.androidSize ?? 0)
      switch (type.formatType) {
        case 'PQ': types.push({ type: '128k', size }); _types['128k'] = { size }; break
        case 'HQ': types.push({ type: '320k', size }); _types['320k'] = { size }; break
        case 'SQ': types.push({ type: 'flac', size }); _types.flac = { size }; break
        case 'ZQ': types.push({ type: 'flac24bit', size }); _types.flac24bit = { size }; break
      }
    }
    list.push({
      singer: formatSingerName(item.singerList),
      name: item.songName,
      albumName: item.album ?? '',
      albumId: item.albumId,
      songmid: item.songId,
      copyrightId: item.copyrightId,
      source: 'mg',
      interval: formatPlayTime(item.duration),
      img: item.img3 || item.img2 || item.img1 || null,
      lrc: null,
      lrcUrl: item.lrcUrl,
      mrcUrl: item.mrcUrl,
      trcUrl: item.trcUrl,
      otherSource: null,
      types,
      _types,
      typeUrl: {},
    })
  }
  return list
}

export default {
  async search(text: string, page = 1, limit = 20): Promise<SongListSearchResult> {
    const time = Date.now().toString()
    const sign = createSignature(time, text)
    const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=1&isCopyright=1&searchSwitch=%7B%22song%22%3A0%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A0%2C%22mvSong%22%3A0%2C%22bestShow%22%3A0%2C%22songlist%22%3A1%2C%22lyricSong%22%3A0%7D&pageSize=${limit}&text=${encodeURIComponent(text)}&pageNo=${page}&sort=0&sid=USS`
    const { body } = await httpFetch<{ songListResultData?: { result: MgSongListRaw[]; totalCount: string } }>(url, {
      headers: {
        uiVersion: 'A_music_3.6.1',
        deviceId: sign.deviceId,
        timestamp: time,
        sign: sign.sign,
        channel: '0146921',
        'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
      },
    }).promise
    if (!body.songListResultData) throw new Error('搜索咪咕歌单失败')
    const list: SongListItem[] = body.songListResultData.result.filter((i) => i.id).map((item) => {
      const playCount = parseInt(String(item.playNum))
      return {
        play_count: isNaN(playCount) ? 0 : formatPlayCount(playCount),
        id: String(item.id),
        author: item.userName ?? '',
        name: item.name ?? '',
        img: item.musicListPicUrl,
        total: item.musicNum,
        source: 'mg',
      }
    })
    return { list, limit, total: parseInt(body.songListResultData.totalCount) || list.length, source: 'mg' }
  },

  async getListDetailInfo(id: string): Promise<SongListDetailResult['info']> {
    const { body } = await httpFetch<{ code: string; data: { title: string; imgItem: { img: string }; summary: string; ownerName: string; opNumItem: { playNum: number } } }>(
      `https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=${id}`,
      { headers: DEFAULT_HEADERS },
    ).promise
    if (body.code !== SUCCESS) return {}
    return {
      name: body.data.title,
      img: body.data.imgItem?.img,
      desc: body.data.summary,
      author: body.data.ownerName,
      play_count: formatPlayCount(body.data.opNumItem?.playNum),
    }
  },

  async getListDetail(id: string): Promise<SongListDetailResult> {
    const info = await this.getListDetailInfo(id).catch(() => ({} as SongListDetailResult['info']))
    const all: MgDetailSong[] = []
    let total = 0
    // 翻页拉全（单页上限 50）
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      const url = `https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${pageNo}&pageSize=${PAGE_SIZE}&playlistId=${id}`
      const { body } = await httpFetch<{ code: string; data: { songList: MgDetailSong[]; totalCount: number } }>(url, { headers: DEFAULT_HEADERS }).promise
      if (body.code !== SUCCESS) {
        if (pageNo === 1) throw new Error('获取咪咕歌单详情失败')
        break
      }
      const songList = body.data?.songList ?? []
      total = body.data?.totalCount ?? total
      all.push(...songList)
      if (songList.length < PAGE_SIZE || all.length >= total) break
    }
    return {
      list: filterMusicInfoListV5(all),
      page: 1,
      limit: all.length,
      total: total || all.length,
      source: 'mg',
      info,
    }
  },
}
