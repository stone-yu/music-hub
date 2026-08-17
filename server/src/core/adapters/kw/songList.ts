/**
 * 酷我歌单适配器 — 移植自 lx-music-desktop@9c364b4 kw/songList.js
 *   search：搜歌单；getListDetail：取歌单内歌曲（可直接下载）
 * 仅移植个人自用所需的 search + getListDetail(digest8)，标签/排行榜略。
 */
import { httpFetch } from '../http.js'
import {
  decodeName, formatPlayTime, formatPlayCount, objStr2JSON,
  type MusicInfo, type MusicQualityType, type SongListItem, type SongListSearchResult, type SongListDetailResult,
} from '../common.js'

const formatSinger = (raw: string): string => raw.replace(/&/g, '、')
const mInfoRegex = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/
const LIMIT_SONG = 1000

interface KwSearchRaw {
  abslist: Array<{ playlistid: string; nickname: string; name: string; songnum: string; pic: string; intro: string; playcnt: string }>
  TOTAL: string
}
interface KwDetailItem { N_MINFO: string; artist: string; name: string; album: string; albumid: string; id: string; duration: string }

function filterListDetail(rawData: KwDetailItem[]): MusicInfo[] {
  return rawData.map((item) => {
    const types: MusicQualityType[] = []
    const _types: MusicInfo['_types'] = {}
    for (let info of (item.N_MINFO ?? '').split(';')) {
      const m = info.match(mInfoRegex)
      if (!m) continue
      const size = m[4]
      switch (m[2]) {
        case '4000': types.push({ type: 'flac24bit', size }); _types.flac24bit = { size }; break
        case '2000': types.push({ type: 'flac', size }); _types.flac = { size }; break
        case '320': types.push({ type: '320k', size }); _types['320k'] = { size }; break
        case '128': types.push({ type: '128k', size }); _types['128k'] = { size }; break
      }
    }
    types.reverse()
    return {
      singer: formatSinger(decodeName(item.artist)),
      name: decodeName(item.name),
      albumName: decodeName(item.album),
      albumId: item.albumid,
      songmid: item.id,
      source: 'kw',
      interval: formatPlayTime(parseInt(item.duration)),
      img: null,
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
    const url = `http://search.kuwo.cn/r.s?all=${encodeURIComponent(text)}&pn=${page - 1}&rn=${limit}&rformat=json&encoding=utf8&ver=mbox&vipver=MUSIC_8.7.7.0_BCS37&plat=pc&devid=28156413&ft=playlist&pay=0&needliveshow=0`
    const { body } = await httpFetch<string | KwSearchRaw>(url).promise
    const data = (typeof body === 'string' ? objStr2JSON<KwSearchRaw>(body) : body)
    const list: SongListItem[] = (data.abslist ?? []).map((item) => ({
      play_count: formatPlayCount(item.playcnt),
      id: String(item.playlistid),
      author: decodeName(item.nickname),
      name: decodeName(item.name),
      total: parseInt(item.songnum),
      img: item.pic,
      desc: decodeName(item.intro),
      source: 'kw',
    }))
    return { list, limit, total: parseInt(data.TOTAL) || list.length, source: 'kw' }
  },

  async getListDetail(id: string, page = 1): Promise<SongListDetailResult> {
    const url = `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=${page - 1}&rn=${LIMIT_SONG}&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`
    const { body } = await httpFetch<{ result: string; musiclist: KwDetailItem[]; rn: number; total: number; title: string; pic: string; info: string; uname: string; playnum: number }>(url).promise
    if (body.result !== 'ok') throw new Error('获取酷我歌单详情失败')
    return {
      list: filterListDetail(body.musiclist ?? []),
      page,
      limit: body.rn,
      total: body.total,
      source: 'kw',
      info: { name: body.title, img: body.pic, desc: body.info, author: body.uname, play_count: formatPlayCount(body.playnum) },
    }
  },
}
