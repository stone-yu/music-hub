/**
 * 酷狗歌单适配器 — 移植自 lx-music-desktop@9c364b4 kg/songList.js
 *   search：v3/search/special 搜歌单
 *   getListDetail：抓 special/single HTML 页 → 提取 global.data → gateway 批量补齐音质
 * 仅保留 specialid 路径（search 结果 id 形如 id_xxx），用户链接/纯数字 code 的分支略去。
 */
import { httpFetch } from '../http.js'
import {
  decodeName, formatPlayTime, sizeFormate, dateFormat, formatPlayCount,
  type MusicInfo, type MusicQualityType, type SongListItem, type SongListSearchResult, type SongListDetailResult,
} from '../common.js'

const LIST_DATA_RE = /global\.data = (\[.+\]);/
const LIST_INFO_RE = /global = {[\s\S]+?name: "(.+)"[\s\S]+?pic: "(.+)"[\s\S]+?};/
const LIST_DETAIL_LINK_RE = /^.+\/single\/(\d+)-.+\.html$/

interface KgSearchItem {
  specialid: string | number; playcount: number; nickname: string; specialname: string
  publishtime: string; imgurl: string; intro: string; songcount: number
}
interface KgHashItem { hash: string }
interface KgAudioInfo {
  audio_id: string | number; hash: string; timelength: number
  filesize: string; filesize_320: string; hash_320: string
  filesize_flac: string; hash_flac: string; filesize_high: string; hash_high: string
}
interface KgGatewaySong {
  audio_info: KgAudioInfo; author_name: string; songname: string
  album_info: { album_name: string; album_id: string | number }
}

function parseHtmlDesc(html: string): string | null {
  const prefix = '<div class="pc_specail_text pc_singer_tab_content" id="specailIntroduceWrap">'
  let index = html.indexOf(prefix)
  if (index < 0) return null
  const afterStr = html.substring(index + prefix.length)
  index = afterStr.indexOf('</div>')
  if (index < 0) return null
  return decodeName(afterStr.substring(0, index))
}

/** gateway 批量取音质信息（对齐上游 createTask），每 100 首一批 */
async function fetchAudioInfos(hashList: KgHashItem[]): Promise<KgGatewaySong[]> {
  const base = {
    area_code: '1', show_privilege: 1, show_album_info: '1', is_publish: '',
    appid: 1005, clientver: 11451, mid: '1', dfid: '-', clienttime: Date.now(),
    key: 'OIlwieks28dk2k092lksi2UIkp',
    fields: 'album_info,author_name,audio_info,ori_audio_name,base,songname',
  }
  const tasks: Record<string, unknown>[] = []
  let list = hashList
  while (list.length) {
    tasks.push({ ...base, data: list.slice(0, 100) })
    if (list.length < 100) break
    list = list.slice(100)
  }
  const url = 'http://gateway.kugou.com/v2/album_audio/audio'
  const results = await Promise.all(tasks.map(async (task) => {
    const { body } = await httpFetch<{ data: KgGatewaySong[][] }>(url, {
      method: 'post',
      body: task,
      headers: {
        'KG-THash': '13a3164', 'KG-RC': '1', 'KG-Fake': '0', 'KG-RF': '00869891',
        'User-Agent': 'Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi',
        'x-router': 'kmr.service.kugou.com',
      },
    }).promise
    return (body.data ?? []).map((s) => s[0]).filter(Boolean) as KgGatewaySong[]
  }))
  return results.flat()
}

function filterData2(rawList: KgGatewaySong[]): MusicInfo[] {
  const ids = new Set<string | number>()
  const list: MusicInfo[] = []
  for (const item of rawList) {
    if (!item?.audio_info) continue
    if (ids.has(item.audio_info.audio_id)) continue
    ids.add(item.audio_info.audio_id)
    const ai = item.audio_info
    const types: MusicQualityType[] = []
    const _types: MusicInfo['_types'] = {}
    if (ai.filesize !== '0') { const size = sizeFormate(parseInt(ai.filesize)); types.push({ type: '128k', size }); _types['128k'] = { size } }
    if (ai.filesize_320 !== '0') { const size = sizeFormate(parseInt(ai.filesize_320)); types.push({ type: '320k', size }); _types['320k'] = { size } }
    if (ai.filesize_flac !== '0') { const size = sizeFormate(parseInt(ai.filesize_flac)); types.push({ type: 'flac', size }); _types.flac = { size } }
    if (ai.filesize_high !== '0') { const size = sizeFormate(parseInt(ai.filesize_high)); types.push({ type: 'flac24bit', size }); _types.flac24bit = { size } }
    list.push({
      singer: decodeName(item.author_name),
      name: decodeName(item.songname),
      albumName: decodeName(item.album_info.album_name),
      albumId: item.album_info.album_id,
      songmid: ai.audio_id,
      source: 'kg',
      interval: formatPlayTime(parseInt(String(ai.timelength)) / 1000),
      img: null,
      lrc: null,
      hash: ai.hash,
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
    const url = `http://msearchretry.kugou.com/api/v3/search/special?keyword=${encodeURIComponent(text)}&page=${page}&pagesize=${limit}&showtype=10&filter=0&version=7910&sver=2`
    const { body } = await httpFetch<{ errcode: number; data: { info: KgSearchItem[]; total: number } }>(url).promise
    if (body.errcode !== 0) throw new Error('搜索酷狗歌单失败')
    const list: SongListItem[] = (body.data.info ?? []).map((item) => ({
      play_count: formatPlayCount(item.playcount),
      id: 'id_' + item.specialid,
      author: item.nickname,
      name: item.specialname,
      time: dateFormat(item.publishtime, 'Y-M-D'),
      img: item.imgurl,
      desc: item.intro,
      total: item.songcount,
      source: 'kg',
    }))
    return { list, limit, total: body.data.total || list.length, source: 'kg' }
  },

  async getListDetail(id: string, page = 1, tryNum = 0): Promise<SongListDetailResult> {
    if (tryNum > 2) throw new Error('获取酷狗歌单详情失败：try max num')
    let sid = String(id)
    if (sid.includes('special/single/')) sid = sid.replace(LIST_DETAIL_LINK_RE, '$1')
    else if (sid.startsWith('id_')) sid = sid.replace('id_', '')
    const url = `http://www2.kugou.kugou.com/yueku/v9/special/single/${sid}-5-9999.html`
    const { body } = await httpFetch<string>(url).promise
    const html = typeof body === 'string' ? body : JSON.stringify(body)
    const listData = html.match(LIST_DATA_RE)
    if (!listData) return this.getListDetail(id, page, tryNum + 1)
    const listInfo = html.match(LIST_INFO_RE)
    const hashes: KgHashItem[] = JSON.parse(listData[1]!).map((it: { hash: string }) => ({ hash: it.hash }))
    const audioInfos = await fetchAudioInfos(hashes)
    const list = filterData2(audioInfos)
    return {
      list,
      page: 1,
      limit: 10000,
      total: list.length,
      source: 'kg',
      info: { name: listInfo?.[1], img: listInfo?.[2], desc: parseHtmlDesc(html) },
    }
  },
}
