/**
 * kg 歌词适配器 — 移植自上游 src/renderer/utils/musicSdk/kg/lyric.js@9c364b4
 * 两步：searchLyric（拿 id/accessKey/fmt）→ getLyricDownload（krc 解密 / lrc base64）。
 */
import { httpFetch } from '../http.js'
import { decodeKrc, type KgLyricResult } from './decodeKrc.js'
import type { MusicInfo } from '../common.js'

const KG_HEADERS = {
  'KG-RC': '1',
  'KG-THash': 'expand_search_manager.cpp:852736169:451',
  'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
}

function getIntv(interval?: string | 0): number {
  if (!interval) return 0
  const intvArr = String(interval).split(':')
  let intv = 0
  let unit = 1
  while (intvArr.length) {
    intv += Number(intvArr.pop()) * unit
    unit *= 60
  }
  return parseInt(String(intv))
}

interface SearchLyricResult {
  id: string
  accessKey: string
  fmt: 'krc' | 'lrc'
}

async function searchLyric(name: string, hash: string, time: number, tryNum = 0): Promise<SearchLyricResult | null> {
  if (tryNum > 5) throw new Error('歌词获取失败')
  const url = `http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(name)}&hash=${hash}&timelength=${time}&lrctxt=1`
  const { body, statusCode } = await httpFetch<{ candidates: { id: string; accesskey: string; krctype: number; contenttype: number }[] }>(url, { headers: KG_HEADERS }).promise
  if (statusCode !== 200) return searchLyric(name, hash, time, tryNum + 1)
  if (body.candidates?.length) {
    const info = body.candidates[0]!
    return {
      id: info.id,
      accessKey: info.accesskey,
      fmt: info.krctype === 1 && info.contenttype !== 1 ? 'krc' : 'lrc',
    }
  }
  return null
}

async function getLyricDownload(id: string, accessKey: string, fmt: string, tryNum = 0): Promise<KgLyricResult> {
  if (tryNum > 5) throw new Error('歌词获取失败')
  const url = `http://lyrics.kugou.com/download?ver=1&client=pc&id=${id}&accesskey=${accessKey}&fmt=${fmt}&charset=utf8`
  const { body, statusCode } = await httpFetch<{ fmt: string; content: string }>(url, { headers: KG_HEADERS }).promise
  if (statusCode !== 200) return getLyricDownload(id, accessKey, fmt, tryNum + 1)
  switch (body.fmt) {
    case 'krc':
      return decodeKrc(body.content)
    case 'lrc':
      return {
        lyric: Buffer.from(body.content, 'base64').toString('utf-8'),
        tlyric: '',
        rlyric: '',
        lxlyric: '',
      }
    default:
      throw new Error(`未知歌词格式: ${body.fmt}`)
  }
}

export async function getKgLyric(musicInfo: MusicInfo): Promise<KgLyricResult> {
  const time = (musicInfo as { _interval?: number })._interval || getIntv(musicInfo.interval)
  const result = await searchLyric(musicInfo.name, musicInfo.hash ?? '', time)
  if (!result) throw new Error('Get lyric failed')
  return getLyricDownload(result.id, result.accessKey, result.fmt)
}

export default { getLyric: getKgLyric }
