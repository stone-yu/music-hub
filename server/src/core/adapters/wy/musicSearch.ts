/**
 * 网易云搜索适配器 — 移植自上游 src/renderer/utils/musicSdk/wy/musicSearch.js@9c364b4
 */
import { httpFetch } from '../http.js'
import { formatPlayTime, sizeFormate, type MusicInfo, type MusicQualityType, type SearchResult } from '../common.js'
import { eapi } from './crypto.js'

function eapiRequest<T = any>(url: string, data: unknown) {
  return httpFetch<T>('http://interface.music.163.com/eapi/batch', {
    method: 'post',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
      origin: 'https://music.163.com',
    },
    form: eapi(url, data),
  })
}

interface WySimpleSong {
  id: number
  name: string
  dt: number
  ar: { name: string }[]
  al: { name: string; id: number; picUrl: string }
  privilege: { maxBrLevel: string; maxbr: number }
  hr?: { size: number }
  sq?: { size: number }
  h?: { size: number }
  l?: { size: number }
}

export default {
  limit: 30,

  musicSearch(str: string, page: number, limit: number) {
    const req = eapiRequest<{ code: number; data: { resources?: { baseInfo: { simpleSongData: WySimpleSong } }[]; totalCount?: number } }>(
      '/api/search/song/list/page',
      {
        keyword: str,
        needCorrect: '1',
        channel: 'typing',
        offset: limit * (page - 1),
        scene: 'normal',
        total: page == 1,
        limit,
      },
    )
    return req.promise.then(({ body }) => body)
  },

  getSinger(singers: { name: string }[]): string {
    return singers.map((s) => s.name).join('、')
  },

  handleResult(rawList: { baseInfo: { simpleSongData: WySimpleSong } }[] | undefined): MusicInfo[] {
    if (!rawList) return []
    return rawList.map((raw) => {
      const item = raw.baseInfo.simpleSongData
      const types: MusicQualityType[] = []
      const _types: MusicInfo['_types'] = {}
      let size: string | null

      if (item.privilege.maxBrLevel == 'hires') {
        size = item.hr ? sizeFormate(item.hr.size) : null
        types.push({ type: 'flac24bit', size })
        _types.flac24bit = { size }
      }
      // 注意：上游此处 switch 故意不写 break（fall-through），高音质会同时补齐所有低档
      switch (item.privilege.maxbr) {
        case 999000:
          size = item.sq ? sizeFormate(item.sq.size) : null
          types.push({ type: 'flac', size })
          _types.flac = { size }
        // eslint-disable-next-line no-fallthrough
        case 320000:
          size = item.h ? sizeFormate(item.h.size) : null
          types.push({ type: '320k', size })
          _types['320k'] = { size }
        // eslint-disable-next-line no-fallthrough
        case 192000:
        case 128000:
          size = item.l ? sizeFormate(item.l.size) : null
          types.push({ type: '128k', size })
          _types['128k'] = { size }
      }

      types.reverse()

      return {
        singer: this.getSinger(item.ar),
        name: item.name,
        albumName: item.al.name,
        albumId: item.al.id,
        source: 'wy',
        interval: formatPlayTime(item.dt / 1000),
        songmid: item.id,
        img: item.al.picUrl,
        lrc: null,
        types,
        _types,
        typeUrl: {},
      }
    })
  },

  async search(str: string, page = 1, limit?: number, retryNum = 0): Promise<SearchResult> {
    limit ??= this.limit
    if (retryNum > 3) throw new Error('try max num')
    const result = await this.musicSearch(str, page, limit)
    if (!result || result.code !== 200) return this.search(str, page, limit, retryNum + 1)
    const list = this.handleResult(result.data.resources || [])
    const total = result.data.totalCount || 0
    return {
      list,
      allPage: Math.ceil(total / limit),
      limit,
      total,
      source: 'wy',
    }
  },
}
