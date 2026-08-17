/**
 * 酷我搜索适配器 — 移植自上游 src/renderer/utils/musicSdk/kw/musicSearch.js@9c364b4
 * 结构与上游保持对齐，便于跟随上游修复
 */
import { httpFetch } from '../http.js'
import { decodeName, formatPlayTime, type MusicInfo, type MusicQualityType, type SearchResult } from '../common.js'

const formatSinger = (rawData: string): string => rawData.replace(/&/g, '、')

const mInfoRegex = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/

interface KwRawItem {
  MUSICRID: string
  SONGNAME: string
  ARTIST: string
  ALBUM?: string
  ALBUMID?: string
  DURATION: string
  N_MINFO?: string
  web_albumpic_short?: string
}

export default {
  limit: 30,

  musicSearch(str: string, page: number, limit: number) {
    const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(str)}&pn=${page - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`
    return httpFetch<{ TOTAL: string; SHOW: string; abslist: KwRawItem[] }>(url).promise
  },

  handleResult(rawData: KwRawItem[] | undefined): MusicInfo[] | null {
    const result: MusicInfo[] = []
    if (!rawData) return result
    for (const info of rawData) {
      const songId = info.MUSICRID.replace('MUSIC_', '')
      if (!info.N_MINFO) return null // 上游同款：缺 N_MINFO 触发重试

      const types: MusicQualityType[] = []
      const _types: MusicInfo['_types'] = {}
      for (let part of info.N_MINFO.split(';')) {
        const m = part.match(mInfoRegex)
        if (!m) continue
        const size = m[4]?.toUpperCase()
        switch (m[2]) {
          case '4000':
            types.push({ type: 'flac24bit', size: m[4] })
            _types.flac24bit = { size }
            break
          case '2000':
            types.push({ type: 'flac', size: m[4] })
            _types.flac = { size }
            break
          case '320':
            types.push({ type: '320k', size: m[4] })
            _types['320k'] = { size }
            break
          case '128':
            types.push({ type: '128k', size: m[4] })
            _types['128k'] = { size }
            break
        }
      }
      types.reverse()

      const interval = parseInt(info.DURATION)

      result.push({
        name: decodeName(info.SONGNAME),
        singer: formatSinger(decodeName(info.ARTIST)),
        source: 'kw',
        songmid: songId,
        albumId: decodeName(info.ALBUMID ?? ''),
        interval: Number.isNaN(interval) ? 0 : formatPlayTime(interval),
        albumName: info.ALBUM ? decodeName(info.ALBUM) : '',
        lrc: null,
        img: info.web_albumpic_short ? `https://img1.kuwo.cn/star/albumcover/${info.web_albumpic_short}` : null,
        otherSource: null,
        types,
        _types,
        typeUrl: {},
      })
    }
    return result
  },

  async search(str: string, page = 1, limit?: number, retryNum = 0): Promise<SearchResult> {
    limit ??= this.limit
    if (retryNum > 2) throw new Error('try max num')
    const { body: result } = await this.musicSearch(str, page, limit)
    if (!result || (result.TOTAL !== '0' && result.SHOW === '0')) return this.search(str, page, limit, retryNum + 1)
    const list = this.handleResult(result.abslist)
    if (list == null) return this.search(str, page, limit, retryNum + 1)
    const total = parseInt(result.TOTAL)
    return {
      list,
      allPage: Math.ceil(total / limit),
      total,
      limit,
      source: 'kw',
    }
  },
}
