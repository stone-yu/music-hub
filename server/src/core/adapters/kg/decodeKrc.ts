/**
 * kg krc 歌词解密 — 移植自上游 src/common/utils/lyricUtils/kg.js@9c364b4
 * krc：base64 → 去头4字节 → 与 enc_key 循环异或 → zlib inflate → 解析。
 */
import { inflate } from 'node:zlib'
import { decodeName } from '../common.js'

const enc_key = Buffer.from([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69])

function decodeLyric(str: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!str.length) return reject(new Error('empty krc'))
    const buf_str = Buffer.from(str, 'base64').subarray(4)
    for (let i = 0, len = buf_str.length; i < len; i++) {
      buf_str[i] = buf_str[i]! ^ enc_key[i % 16]!
    }
    inflate(buf_str, (err, result) => (err ? reject(err) : resolve(result.toString())))
  })
}

const headExp = /^.*\[id:\$\w+\]\n/

export interface KgLyricResult {
  lyric: string
  tlyric: string
  rlyric: string
  lxlyric: string
}

function parseLyric(input: string): KgLyricResult {
  let str = input.replace(/\r/g, '')
  if (headExp.test(str)) str = str.replace(headExp, '')
  const trans = str.match(/\[language:([\w=\\/+]+)\]/)
  let lyric = ''
  let rlyricArr: string[] | undefined
  let tlyricArr: string[] | undefined
  if (trans) {
    str = str.replace(/\[language:[\w=\\/+]+\]\n/, '')
    const json = JSON.parse(Buffer.from(trans[1]!, 'base64').toString()) as {
      content: { type: number; lyricContent: string[] }[]
    }
    for (const item of json.content) {
      switch (item.type) {
        case 0:
          rlyricArr = item.lyricContent as unknown as string[]
          break
        case 1:
          tlyricArr = item.lyricContent as unknown as string[]
          break
      }
    }
  }
  let i = 0
  let lxlyric = str.replace(/\[((\d+),\d+)\].*/g, (s) => {
    const result = s.match(/\[((\d+),\d+)\].*/)!
    let time = parseInt(result[2]!)
    const ms = time % 1000
    time = Math.trunc(time / 1000)
    const m = Math.trunc(time / 60).toString().padStart(2, '0')
    time %= 60
    const sec = Math.trunc(time).toString().padStart(2, '0')
    const timeStr = `${m}:${sec}.${ms}`
    if (rlyricArr) rlyricArr[i] = `[${timeStr}]${(rlyricArr[i] as unknown as string[])?.join('') ?? ''}`
    if (tlyricArr) tlyricArr[i] = `[${timeStr}]${(tlyricArr[i] as unknown as string[])?.join('') ?? ''}`
    i++
    return s.replace(result[1]!, timeStr)
  })
  let rlyric = rlyricArr ? rlyricArr.join('\n') : ''
  let tlyric = tlyricArr ? tlyricArr.join('\n') : ''
  lxlyric = lxlyric.replace(/<(\d+,\d+),\d+>/g, '<$1>')
  lxlyric = decodeName(lxlyric)
  lyric = lxlyric.replace(/<\d+,\d+>/g, '')
  rlyric = decodeName(rlyric)
  tlyric = decodeName(tlyric)
  return { lyric, tlyric, rlyric, lxlyric }
}

export async function decodeKrc(data: string): Promise<KgLyricResult> {
  return parseLyric(await decodeLyric(data))
}
