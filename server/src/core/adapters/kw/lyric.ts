/**
 * kw 歌词适配器 — 移植自上游 src/renderer/utils/musicSdk/kw/lyric.js@9c364b4
 *
 * 请求 newlyric.kuwo.cn（yeelion 异或 + base64 构参），响应为二进制，
 * 交 decodeKwLyric 解码（zlib inflate + 异或 + gb18030），再解析为 lrc/tlyric/lxlyric。
 * 注意：这里必须拿「原始二进制」响应，不能走 httpFetch（它会 toString/JSON.parse）。
 */
import needle from 'needle'
import { decodeKwLyric } from './decodeLyric.js'
import { lrcTools, decodeName } from './lrcTools.js'

export interface KwLyricResult {
  lyric: string
  tlyric: string
  lxlyric: string
}

const buf_key = Buffer.from('yeelion')
const buf_key_len = buf_key.length

/** 构造 newlyric 请求参数（yeelion 异或 → base64） */
function buildParams(id: string | number, isGetLyricx: boolean): string {
  let params = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${id}`
  if (isGetLyricx) params += '&lrcx=1'
  const buf_str = Buffer.from(params)
  const buf_str_len = buf_str.length
  const output = new Uint16Array(buf_str_len)
  let i = 0
  while (i < buf_str_len) {
    let j = 0
    while (j < buf_key_len && i < buf_str_len) {
      output[i] = buf_key[j]! ^ buf_str[i]!
      i++
      j++
    }
  }
  return Buffer.from(output).toString('base64')
}

const timeExp = /^\[([\d:.]*)\]{1}/g
const existTimeExp = /\[\d{1,2}:.*\d{1,4}\]/
const lyricxTag = /^<-?\d+,-?\d+>/

interface LrcLine {
  time: string
  text: string
}

function sortLrcArr(arr: LrcLine[]): { lrc: LrcLine[]; lrcT: LrcLine[] } {
  const lrcSet = new Set<string>()
  const lrc: LrcLine[] = []
  const lrcT: LrcLine[] = []
  let isLyricx = false
  for (const item of arr) {
    if (lrcSet.has(item.time)) {
      if (lrc.length < 2) continue
      const tItem = lrc.pop()!
      tItem.time = lrc[lrc.length - 1]!.time
      lrcT.push(tItem)
      lrc.push(item)
    } else {
      lrc.push(item)
      lrcSet.add(item.time)
    }
    if (!isLyricx && lyricxTag.test(item.text)) isLyricx = true
  }
  if (!isLyricx && lrcT.length > lrc.length * 0.3 && lrc.length - lrcT.length > 6) {
    throw new Error('failed')
  }
  return { lrc, lrcT }
}

function transformLrc(tags: string[], lrclist: LrcLine[] | null): string {
  return `${tags.join('\n')}\n${lrclist ? lrclist.map((l) => `[${l.time}]${l.text}\n`).join('') : '暂无歌词'}`
}

function parseLrc(lrc: string): { lyric: string; tlyric: string } {
  const lines = lrc.split(/\r\n|\r|\n/)
  const tags: string[] = []
  const lrcArr: LrcLine[] = []
  for (const raw of lines) {
    const line = raw.trim()
    timeExp.lastIndex = 0
    const result = timeExp.exec(line)
    if (result) {
      const text = line.replace(timeExp, '').trim()
      let time = result[1]!
      if (/\.\d\d$/.test(time)) time += '0'
      lrcArr.push({ time, text })
    } else if (lrcTools.rxps.tagLine.test(line)) {
      tags.push(line)
    }
  }
  const lrcInfo = sortLrcArr(lrcArr)
  return {
    lyric: decodeName(transformLrc(tags, lrcInfo.lrc)),
    tlyric: lrcInfo.lrcT.length ? decodeName(transformLrc(tags, lrcInfo.lrcT)) : '',
  }
}

/** 拿 newlyric 原始二进制响应 */
function fetchRaw(url: string): Promise<{ statusCode: number; raw: Buffer }> {
  return new Promise((resolve, reject) => {
    needle.get(url, { response_timeout: 15_000, follow_max: 3, parse_response: false }, (err, resp) => {
      if (err) return reject(err)
      const raw = Buffer.isBuffer(resp.body) ? resp.body : Buffer.from(resp.body as never)
      resolve({ statusCode: resp.statusCode ?? 0, raw })
    })
  })
}

export async function getKwLyric(songmid: string | number, isGetLyricx = true): Promise<KwLyricResult> {
  const url = `http://newlyric.kuwo.cn/newlyric.lrc?${buildParams(songmid, isGetLyricx)}`
  const { statusCode, raw } = await fetchRaw(url)
  if (statusCode !== 200) throw new Error(`kw lyric http ${statusCode}`)

  const decoded = await decodeKwLyric(raw, isGetLyricx)
  const lrcInfo = parseLrc(Buffer.from(decoded).toString())

  let tlyric = lrcInfo.tlyric
  if (tlyric) tlyric = tlyric.replace(lrcTools.rxps.wordTimeAll, '')

  let lxlyric = ''
  try {
    lxlyric = lrcTools.parse(lrcInfo.lyric)
  } catch {
    lxlyric = ''
  }
  const lyric = lrcInfo.lyric.replace(lrcTools.rxps.wordTimeAll, '')
  if (!existTimeExp.test(lyric)) throw new Error('Get lyric failed')

  return { lyric, tlyric, lxlyric }
}

export default { getLyric: getKwLyric }
