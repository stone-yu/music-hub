/**
 * mg 歌词适配器 — 移植自上游 src/renderer/utils/musicSdk/mg/lyric.js@9c364b4
 * mrcUrl → TEA 解密逐字歌词；否则 lrcUrl → 纯 lrc；trcUrl → 翻译。
 * 简化：直接用搜索结果自带的 mrcUrl/lrcUrl/trcUrl，不再回查 musicInfo。
 */
import needle from 'needle'
import { decrypt } from './mrc.js'
import type { MusicInfo } from '../common.js'

const MG_HEADERS = {
  Referer: 'https://app.c.nf.migu.cn/',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 5.1.1; Nexus 6 Build/LYZ28E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36',
  channel: '0146921',
}

export interface MgLyricResult {
  lyric: string
  tlyric: string
  lxlyric: string
}

const rxps = {
  lineTime: /^\s*\[(\d+),\d+\]/,
  wordTime: /\(\d+,\d+\)/,
  wordTimeAll: /(\(\d+,\d+\))/g,
}

function parseLyric(str: string): { lyric: string; lxlyric: string } {
  str = str.replace(/\r/g, '')
  const lines = str.split('\n')
  const lxlrcLines: string[] = []
  const lrcLines: string[] = []
  for (const line of lines) {
    if (line.length < 6) continue
    const result = rxps.lineTime.exec(line)
    if (!result) continue
    const startTime = parseInt(result[1]!)
    let time = startTime
    const ms = time % 1000
    time = Math.trunc(time / 1000)
    const m = Math.trunc(time / 60).toString().padStart(2, '0')
    time %= 60
    const s = Math.trunc(time).toString().padStart(2, '0')
    const timeStr = `${m}:${s}.${ms}`
    const words = line.replace(rxps.lineTime, '')
    lrcLines.push(`[${timeStr}]${words.replace(rxps.wordTimeAll, '')}`)
    const rawTimes = words.match(rxps.wordTimeAll)
    if (!rawTimes) continue
    const times = rawTimes.map((t) => {
      const r = /\((\d+),(\d+)\)/.exec(t)!
      return `<${parseInt(r[1]!) - startTime},${r[2]}>`
    })
    const wordArr = words.split(rxps.wordTime)
    const newWords = times.map((t, index) => `${t}${wordArr[index]}`).join('')
    lxlrcLines.push(`[${timeStr}]${newWords}`)
  }
  return { lyric: lrcLines.join('\n'), lxlyric: lxlrcLines.join('\n') }
}

function getText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    needle.get(url, { headers: MG_HEADERS, response_timeout: 15_000, follow_max: 3, parse_response: false }, (err, resp) => {
      if (err) return reject(err)
      if (resp.statusCode !== 200) return reject(new Error(`mg lyric http ${resp.statusCode}`))
      resolve(Buffer.isBuffer(resp.body) ? resp.body.toString() : String(resp.body))
    })
  })
}

export async function getMgLyric(songInfo: MusicInfo): Promise<MgLyricResult> {
  let lrcInfo: { lyric: string; lxlyric: string }
  if (songInfo.mrcUrl) {
    lrcInfo = parseLyric(decrypt(await getText(songInfo.mrcUrl)))
  } else if (songInfo.lrcUrl) {
    lrcInfo = { lxlyric: '', lyric: await getText(songInfo.lrcUrl) }
  } else {
    throw new Error('获取歌词失败')
  }
  let tlyric = ''
  if (songInfo.trcUrl) {
    try {
      tlyric = await getText(songInfo.trcUrl)
    } catch {
      tlyric = ''
    }
  }
  return { lyric: lrcInfo.lyric, lxlyric: lrcInfo.lxlyric, tlyric }
}

export default { getLyric: getMgLyric }
