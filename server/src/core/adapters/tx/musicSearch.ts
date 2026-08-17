/**
 * QQ音乐搜索适配器 — 移植自上游 src/renderer/utils/musicSdk/tx/musicSearch.js@9c364b4
 */
import { httpFetch } from '../http.js'
import { formatPlayTime, sizeFormate, type MusicInfo, type MusicQualityType, type SearchResult } from '../common.js'
import { zzcSign } from './crypto.js'

function formatSingerName(singers: { name?: string }[] | undefined): string {
  if (!Array.isArray(singers)) return ''
  return singers.map((s) => s.name ?? '').filter(Boolean).join('、')
}

function signRequest(data: unknown) {
  // 注意：签名必须与实际发送的字节完全一致，故先序列化再分别用于签名与请求体
  const raw = JSON.stringify(data)
  const sign = zzcSign(raw)
  return httpFetch<any>(`https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`, {
    method: 'post',
    headers: {
      'User-Agent': 'QQMusic 14090508(android 12)',
      'Content-Type': 'application/json',
    },
    body: raw,
  }).promise
}

interface TxRawItem {
  id: number
  mid: string
  title: string
  interval: number
  singer?: { name?: string; mid?: string }[]
  album?: { name?: string; mid?: string }
  file?: {
    media_mid?: string
    size_128mp3: number
    size_320mp3: number
    size_flac: number
    size_hires: number
  }
}

export default {
  limit: 50,
  successCode: 0,

  async musicSearch(str: string, page: number, limit: number, retryNum = 0): Promise<{ body: { item_song: TxRawItem[] }; meta: { estimate_sum: number } }> {
    if (retryNum > 5) throw new Error('搜索失败')
    const { body } = await signRequest({
      comm: {
        ct: '11',
        cv: '14090508',
        v: '14090508',
        tmeAppID: 'qqmusic',
        phonetype: 'EBG-AN10',
        deviceScore: '553.47',
        devicelevel: '50',
        newdevicelevel: '20',
        rom: 'HuaWei/EMOTION/EmotionUI_14.2.0',
        os_ver: '12',
        OpenUDID: '0',
        OpenUDID2: '0',
        QIMEI36: '0',
        udid: '0',
        chid: '0',
        aid: '0',
        oaid: '0',
        taid: '0',
        tid: '0',
        wid: '0',
        uid: '0',
        sid: '0',
        modeSwitch: '6',
        teenMode: '0',
        ui_mode: '2',
        nettype: '1020',
        v4ip: '',
      },
      req: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicMobile',
        param: {
          search_type: 0,
          searchid: Math.random().toString().slice(2),
          query: str,
          page_num: page,
          num_per_page: limit,
          highlight: 0,
          nqc_flag: 0,
          multi_zhida: 0,
          cat: 2,
          grp: 1,
          sin: 0,
          sem: 0,
        },
      },
    })
    if (!body || !body.req || body.code != this.successCode || body.req.code != this.successCode) {
      // QQ 接口有限流（req.code 2001），连发会被拒，重试前退避
      await new Promise((r) => setTimeout(r, 500 * (retryNum + 1)))
      return this.musicSearch(str, page, limit, retryNum + 1)
    }
    return body.req.data
  },

  handleResult(rawList: TxRawItem[] | undefined): MusicInfo[] {
    if (!rawList || !Array.isArray(rawList)) return []
    const list: MusicInfo[] = []
    for (const item of rawList) {
      if (!item.file?.media_mid) continue

      const types: MusicQualityType[] = []
      const _types: MusicInfo['_types'] = {}
      const file = item.file
      if (file.size_128mp3 != 0) {
        const size = sizeFormate(file.size_128mp3)
        types.push({ type: '128k', size })
        _types['128k'] = { size }
      }
      if (file.size_320mp3 !== 0) {
        const size = sizeFormate(file.size_320mp3)
        types.push({ type: '320k', size })
        _types['320k'] = { size }
      }
      if (file.size_flac !== 0) {
        const size = sizeFormate(file.size_flac)
        types.push({ type: 'flac', size })
        _types.flac = { size }
      }
      if (file.size_hires !== 0) {
        const size = sizeFormate(file.size_hires)
        types.push({ type: 'flac24bit', size })
        _types.flac24bit = { size }
      }

      let albumId = ''
      let albumName = ''
      if (item.album) {
        albumName = item.album.name ?? ''
        albumId = item.album.mid ?? ''
      }
      list.push({
        singer: formatSingerName(item.singer),
        name: item.title,
        albumName,
        albumId,
        source: 'tx',
        interval: formatPlayTime(item.interval),
        albumMid: item.album?.mid ?? '',
        strMediaMid: item.file.media_mid,
        songmid: item.mid,
        img:
          albumId === '' || albumId === '空'
            ? item.singer?.length
              ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg`
              : ''
            : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
        types,
        _types,
        typeUrl: {},
      })
    }
    return list
  },

  async search(str: string, page = 1, limit?: number): Promise<SearchResult> {
    limit ??= this.limit
    const { body, meta } = await this.musicSearch(str, page, limit)
    const list = this.handleResult(body.item_song)
    const total = meta.estimate_sum
    return {
      list,
      allPage: Math.ceil(total / limit),
      total,
      limit,
      source: 'tx',
    }
  },
}
