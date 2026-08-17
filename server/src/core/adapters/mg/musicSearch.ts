/**
 * 咪咕搜索适配器 — 移植自上游 src/renderer/utils/musicSdk/mg/musicSearch.js@9c364b4
 */
import { createHash } from 'node:crypto'
import { httpFetch } from '../http.js'
import { formatPlayTime, sizeFormate, type MusicInfo, type MusicQualityType, type SearchResult } from '../common.js'

function toMD5(str: string): string {
  return createHash('md5').update(str).digest('hex')
}

function formatSingerName(singerList: { name?: string }[] | undefined): string {
  if (!Array.isArray(singerList)) return ''
  return singerList.map((s) => s.name ?? '').filter(Boolean).join('、')
}

export function createSignature(time: string, str: string): { sign: string; deviceId: string } {
  const deviceId = '963B7AA0D21511ED807EE5846EC87D20'
  const signatureMd5 = '6cdc72a439cef99a3418d2a78aa28c73'
  const sign = toMD5(`${str}${signatureMd5}yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${time}`)
  return { sign, deviceId }
}

interface MgAudioFormat {
  formatType: string
  asize?: number
  isize?: number
}

interface MgRawItem {
  songId?: string
  copyrightId?: string
  name: string
  album?: string
  albumId?: string | number
  duration: number
  singerList?: { name?: string }[]
  audioFormats?: MgAudioFormat[]
  img1?: string
  img2?: string
  img3?: string
  lrcUrl?: string
  mrcurl?: string
  trcUrl?: string
}

export default {
  limit: 20,

  musicSearch(str: string, page: number, limit: number) {
    const time = Date.now().toString()
    const signData = createSignature(time, str)
    const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=${limit}&text=${encodeURIComponent(str)}&pageNo=${page}&sort=0&sid=USS`
    return httpFetch<{ code: string; info?: string; songResultData?: { resultList: MgRawItem[][]; totalCount: string } }>(url, {
      headers: {
        uiVersion: 'A_music_3.6.1',
        deviceId: signData.deviceId,
        timestamp: time,
        sign: signData.sign,
        channel: '0146921',
        'User-Agent':
          'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
      },
    }).promise.then(({ body }) => body)
  },

  filterData(rawData: MgRawItem[][]): MusicInfo[] {
    const list: MusicInfo[] = []
    const ids = new Set<string>()
    for (const item of rawData) {
      for (const data of item) {
        if (!data.songId || !data.copyrightId || ids.has(data.copyrightId)) continue
        ids.add(data.copyrightId)

        const types: MusicQualityType[] = []
        const _types: MusicInfo['_types'] = {}
        for (const type of data.audioFormats ?? []) {
          const size = sizeFormate(type.asize ?? type.isize ?? 0)
          switch (type.formatType) {
            case 'PQ':
              types.push({ type: '128k', size })
              _types['128k'] = { size }
              break
            case 'HQ':
              types.push({ type: '320k', size })
              _types['320k'] = { size }
              break
            case 'SQ':
              types.push({ type: 'flac', size })
              _types.flac = { size }
              break
            case 'ZQ24':
              types.push({ type: 'flac24bit', size })
              _types.flac24bit = { size }
              break
          }
        }

        let img = data.img3 || data.img2 || data.img1 || null
        if (img && data.img3 && !/https?:/.test(data.img3)) img = 'http://d.musicapp.migu.cn' + img

        list.push({
          singer: formatSingerName(data.singerList),
          name: data.name,
          albumName: data.album ?? '',
          albumId: data.albumId,
          songmid: data.songId,
          copyrightId: data.copyrightId,
          source: 'mg',
          interval: formatPlayTime(data.duration),
          img,
          lrc: null,
          lrcUrl: data.lrcUrl,
          mrcUrl: data.mrcurl,
          trcUrl: data.trcUrl,
          types,
          _types,
          typeUrl: {},
        })
      }
    }
    return list
  },

  async search(str: string, page = 1, limit?: number, retryNum = 0): Promise<SearchResult> {
    limit ??= this.limit
    if (retryNum > 3) throw new Error('try max num')
    const result = await this.musicSearch(str, page, limit)
    if (!result || result.code !== '000000') throw new Error(result ? (result.info ?? '搜索失败') : '搜索失败')
    const songResultData = result.songResultData || { resultList: [], totalCount: '0' }
    const list = this.filterData(songResultData.resultList)
    const total = parseInt(songResultData.totalCount)
    return {
      list,
      allPage: Math.ceil(total / limit),
      limit,
      total,
      source: 'mg',
    }
  },
}
