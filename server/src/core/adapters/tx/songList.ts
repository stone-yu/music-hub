/**
 * QQ音乐歌单适配器 — 移植自 lx-music-desktop@9c364b4 tx/songList.js
 *   search：搜歌单；getListDetail：取歌单内歌曲（可直接下载）
 */
import { httpFetch } from '../http.js'
import {
  decodeName, formatPlayTime, formatPlayCount, sizeFormate, dateFormat,
  type MusicInfo, type MusicQualityType, type SongListItem, type SongListSearchResult, type SongListDetailResult,
} from '../common.js'

function formatSingerName(singers: { name?: string }[] | undefined): string {
  if (!Array.isArray(singers)) return ''
  return singers.map((s) => s.name ?? '').filter(Boolean).join('、')
}

interface TxSearchItem {
  dissid: string
  creator: { name: string }
  dissname: string
  createtime: number
  imgurl: string
  song_count: number
  listennum: number
  introduction: string
}
interface TxDetailSong {
  file: { size_128mp3: number; size_320mp3: number; size_flac: number; size_hires: number; media_mid: string }
  singer: { name?: string; mid?: string }[]
  title: string
  album: { name: string; mid: string }
  interval: number
  id: string | number
  mid: string
}

function filterListDetail(rawList: TxDetailSong[]): MusicInfo[] {
  return rawList.map((item) => {
    const types: MusicQualityType[] = []
    const _types: MusicInfo['_types'] = {}
    if (item.file.size_128mp3 !== 0) { const size = sizeFormate(item.file.size_128mp3); types.push({ type: '128k', size }); _types['128k'] = { size } }
    if (item.file.size_320mp3 !== 0) { const size = sizeFormate(item.file.size_320mp3); types.push({ type: '320k', size }); _types['320k'] = { size } }
    if (item.file.size_flac !== 0) { const size = sizeFormate(item.file.size_flac); types.push({ type: 'flac', size }); _types.flac = { size } }
    if (item.file.size_hires !== 0) { const size = sizeFormate(item.file.size_hires); types.push({ type: 'flac24bit', size }); _types.flac24bit = { size } }
    const albumName = item.album?.name ?? ''
    return {
      singer: formatSingerName(item.singer),
      name: item.title,
      albumName,
      albumId: item.album?.mid,
      source: 'tx',
      interval: formatPlayTime(item.interval),
      songmid: item.mid,
      albumMid: item.album?.mid,
      strMediaMid: item.file.media_mid,
      img: (albumName === '' || albumName === '空')
        ? (item.singer?.length ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0]!.mid}.jpg` : '')
        : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album.mid}.jpg`,
      lrc: null,
      otherSource: null,
      types,
      _types,
      typeUrl: {},
    }
  })
}

export default {
  async search(text: string, page = 1, limit = 20): Promise<SongListSearchResult> {
    const url = `http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?page_no=${page - 1}&num_per_page=${limit}&format=json&query=${encodeURIComponent(text)}&remoteplace=txt.yqq.playlist&inCharset=utf8&outCharset=utf-8`
    const { body } = await httpFetch<{ code: number; data: { list: TxSearchItem[]; sum: number } }>(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
        Referer: 'http://y.qq.com/portal/search.html',
      },
    }).promise
    if (body.code !== 0) throw new Error('搜索QQ音乐歌单失败')
    const list: SongListItem[] = (body.data.list ?? []).map((item) => ({
      play_count: formatPlayCount(item.listennum),
      id: String(item.dissid),
      author: decodeName(item.creator.name),
      name: decodeName(item.dissname),
      time: dateFormat(item.createtime, 'Y-M-D'),
      img: item.imgurl,
      total: item.song_count,
      desc: decodeName(decodeName(item.introduction)).replace(/<br>/g, '\n'),
      source: 'tx',
    }))
    return { list, limit, total: body.data.sum || list.length, source: 'tx' }
  },

  async getListDetail(id: string): Promise<SongListDetailResult> {
    const url = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${id}&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`
    const { body } = await httpFetch<{ code: number; cdlist: Array<{ songlist: TxDetailSong[]; dissname: string; logo: string; desc: string; nickname: string; visitnum: number }> }>(url, {
      headers: { Origin: 'https://y.qq.com', Referer: `https://y.qq.com/n/yqq/playsquare/${id}.html` },
    }).promise
    if (body.code !== 0) throw new Error('获取QQ音乐歌单详情失败')
    const cdlist = body.cdlist[0]!
    return {
      list: filterListDetail(cdlist.songlist ?? []),
      page: 1,
      limit: (cdlist.songlist?.length ?? 0) + 1,
      total: cdlist.songlist?.length ?? 0,
      source: 'tx',
      info: { name: cdlist.dissname, img: cdlist.logo, desc: decodeName(cdlist.desc).replace(/<br>/g, '\n'), author: cdlist.nickname, play_count: formatPlayCount(cdlist.visitnum) },
    }
  },
}
