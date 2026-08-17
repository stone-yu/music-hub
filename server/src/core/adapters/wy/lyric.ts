/**
 * wy 网易云歌词适配器 — 移植自上游 src/renderer/utils/musicSdk/wy/lyric.js@9c364b4
 * eapi 请求 /api/song/lyric/v1；yrc(逐字) 为明文，无需原生依赖。
 */
import needle from 'needle'
import { eapi } from './crypto.js'

export interface WyLyricResult {
  lyric: string
  tlyric: string
  rlyric: string
  lxlyric: string
}

const rxps = {
  info: /^{"/,
  lineTime: /^\[(\d+),\d+\]/,
  wordTime: /\(\d+,\d+,\d+\)/,
  wordTimeAll: /(\(\d+,\d+,\d+\))/g,
}

function msFormat(timeMs: number): string {
  if (Number.isNaN(timeMs)) return ''
  const ms = timeMs % 1000
  timeMs = Math.trunc(timeMs / 1000)
  const m = Math.trunc(timeMs / 60).toString().padStart(2, '0')
  timeMs %= 60
  const s = Math.trunc(timeMs).toString().padStart(2, '0')
  return `[${m}:${s}.${ms}]`
}

function parseLyricLines(lines: string[]): { lyric: string; lxlyric: string } {
  const lxlrcLines: string[] = []
  const lrcLines: string[] = []
  for (let line of lines) {
    line = line.trim()
    const result = rxps.lineTime.exec(line)
    if (!result) {
      if (line.startsWith('[offset')) {
        lxlrcLines.push(line)
        lrcLines.push(line)
      }
      continue
    }
    const startMsTime = parseInt(result[1]!)
    const startTimeStr = msFormat(startMsTime)
    if (!startTimeStr) continue
    const words = line.replace(rxps.lineTime, '')
    lrcLines.push(`${startTimeStr}${words.replace(rxps.wordTimeAll, '')}`)
    const rawTimes = words.match(rxps.wordTimeAll)
    if (!rawTimes) continue
    const times = rawTimes.map((t) => {
      const r = /\((\d+),(\d+),\d+\)/.exec(t)!
      return `<${Math.max(parseInt(r[1]!) - startMsTime, 0)},${r[2]}>`
    })
    const wordArr = words.split(rxps.wordTime)
    wordArr.shift()
    const newWords = times.map((t, index) => `${t}${wordArr[index]}`).join('')
    lxlrcLines.push(`${startTimeStr}${newWords}`)
  }
  return { lyric: lrcLines.join('\n'), lxlyric: lxlrcLines.join('\n') }
}

function parseHeaderInfo(str: string): string[] | null {
  str = str.trim().replace(/\r/g, '')
  if (!str) return null
  const lines = str.split('\n')
  return lines.map((line) => {
    if (!rxps.info.test(line)) return line
    try {
      const info = JSON.parse(line) as { t: number; c: { tx: string }[] }
      const timeTag = msFormat(info.t)
      return timeTag ? `${timeTag}${info.c.map((t) => t.tx).join('')}` : ''
    } catch {
      return ''
    }
  })
}

function getIntv(interval: string): number {
  if (!interval) return 0
  if (!interval.includes('.')) interval += '.0'
  const arr = interval.split(/:|\./)
  while (arr.length < 3) arr.unshift('0')
  const [m, s, ms] = arr
  return parseInt(m!) * 3600000 + parseInt(s!) * 1000 + parseInt(ms!)
}

function fixTimeTag(lrc: string, targetlrc: string): string {
  let lrcLines = lrc.split('\n')
  const targetlrcLines = targetlrc.split('\n')
  const timeRxp = /^\[([\d:.]+)\]/
  let temp: string[] = []
  const newLrc: string[] = []
  targetlrcLines.forEach((line) => {
    const result = timeRxp.exec(line)
    if (!result) return
    const words = line.replace(timeRxp, '')
    if (!words.trim()) return
    const t1 = getIntv(result[1]!)
    while (lrcLines.length) {
      const lrcLine = lrcLines.shift()!
      const lrcLineResult = timeRxp.exec(lrcLine)
      if (!lrcLineResult) continue
      const t2 = getIntv(lrcLineResult[1]!)
      if (Math.abs(t1 - t2) < 100) {
        const fixed = line.replace(timeRxp, lrcLineResult[0]).trim()
        if (fixed) newLrc.push(fixed)
        break
      }
      temp.push(lrcLine)
    }
    lrcLines = [...temp, ...lrcLines]
    temp = []
  })
  return newLrc.join('\n')
}

function parse(ylrc: string, ytlrc: string, yrlrc: string, lrc: string, tlrc: string, rlrc: string): WyLyricResult {
  const info: WyLyricResult = { lyric: '', tlyric: '', rlyric: '', lxlyric: '' }
  if (ylrc) {
    const lines = parseHeaderInfo(ylrc)
    if (lines) {
      const result = parseLyricLines(lines)
      if (ytlrc) {
        const tl = parseHeaderInfo(ytlrc)
        if (tl) info.tlyric = fixTimeTag(result.lyric, tl.join('\n'))
      }
      if (yrlrc) {
        const rl = parseHeaderInfo(yrlrc)
        if (rl) info.rlyric = fixTimeTag(result.lyric, rl.join('\n'))
      }
      const timeRxp = /^\[[\d:.]+\]/
      const headers = lines.filter((l) => timeRxp.test(l)).join('\n')
      info.lyric = `${headers}\n${result.lyric}`
      info.lxlyric = result.lxlyric
      return info
    }
  }
  if (lrc) {
    const lines = parseHeaderInfo(lrc)
    if (lines) info.lyric = lines.join('\n')
  }
  if (tlrc) {
    const lines = parseHeaderInfo(tlrc)
    if (lines) info.tlyric = lines.join('\n')
  }
  if (rlrc) {
    const lines = parseHeaderInfo(rlrc)
    if (lines) info.rlyric = lines.join('\n')
  }
  return info
}

function fixTimeLabel(lrc: string, tlrc?: string, romalrc?: string): { lrc: string; tlrc?: string; romalrc?: string } {
  if (lrc) {
    const newLrc = lrc.replace(/\[(\d{2}:\d{2}):(\d{2})]/g, '[$1.$2]')
    const newTlrc = tlrc?.replace(/\[(\d{2}:\d{2}):(\d{2})]/g, '[$1.$2]') ?? tlrc
    if (newLrc !== lrc || newTlrc !== tlrc) {
      lrc = newLrc
      tlrc = newTlrc
      if (romalrc) romalrc = romalrc.replace(/\[(\d{2}:\d{2}):(\d{2,3})]/g, '[$1.$2]').replace(/\[(\d{2}:\d{2}\.\d{2})0]/g, '[$1]')
    }
  }
  return { lrc, tlrc, romalrc }
}

interface WyLyricBody {
  code: number
  lrc?: { lyric: string }
  tlyric?: { lyric: string }
  romalrc?: { lyric: string }
  yrc?: { lyric: string }
  ytlrc?: { lyric: string }
  yromalrc?: { lyric: string }
}

function eapiRequest(url: string, data: unknown): Promise<WyLyricBody> {
  const form = eapi(url, data)
  return new Promise((resolve, reject) => {
    needle.post(
      'https://interface3.music.163.com/eapi/song/lyric/v1',
      form as unknown as Record<string, string>,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
          origin: 'https://music.163.com',
        },
        response_timeout: 15_000,
      },
      (err, resp) => {
        if (err) return reject(err)
        let body: unknown = resp.body
        if (Buffer.isBuffer(body)) body = body.toString()
        if (typeof body === 'string') {
          try {
            body = JSON.parse(body)
          } catch {
            /* keep */
          }
        }
        resolve(body as WyLyricBody)
      },
    )
  })
}

export async function getWyLyric(songmid: string | number): Promise<WyLyricResult> {
  const body = await eapiRequest('/api/song/lyric/v1', {
    id: songmid,
    cp: false,
    tv: 0,
    lv: 0,
    rv: 0,
    kv: 0,
    yv: 0,
    ytv: 0,
    yrv: 0,
  })
  if (body.code !== 200 || !body?.lrc?.lyric) throw new Error('Get lyric failed')
  const fixed = fixTimeLabel(body.lrc.lyric, body.tlyric?.lyric, body.romalrc?.lyric)
  const info = parse(
    body.yrc?.lyric ?? '',
    body.ytlrc?.lyric ?? '',
    body.yromalrc?.lyric ?? '',
    fixed.lrc,
    fixed.tlrc ?? '',
    fixed.romalrc ?? '',
  )
  if (!info.lyric) throw new Error('Get lyric failed')
  return info
}

export default { getLyric: getWyLyric }
