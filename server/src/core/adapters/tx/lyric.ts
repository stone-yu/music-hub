/**
 * tx QQ音乐歌词适配器
 *
 * 注意：上游主线用逐字歌词(qrc)，需预构建 C++ 原生模块 qrc_decode.node 解密。
 * 无头环境无 g++、也不宜引入 electron 版原生二进制，故改用上游文件内
 * 被注释保留的「旧版明文接口」fcg_query_lyric_new.fcg（返回 base64 明文 lrc）。
 * 拿到的是普通逐行歌词（无逐字），足够嵌入标签使用。
 */
import { httpFetch } from '../http.js'
import { decodeName } from '../common.js'

export interface TxLyricResult {
  lyric: string
  tlyric: string
}

function b64DecodeUnicode(str: string): string {
  if (!str) return ''
  return Buffer.from(str, 'base64').toString('utf-8')
}

export async function getTxLyric(songmid: string | number): Promise<TxLyricResult> {
  const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${songmid}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq`
  const { body } = await httpFetch<{ code: number; lyric?: string; trans?: string }>(url, {
    headers: { Referer: 'https://y.qq.com/portal/player.html' },
  }).promise
  if (body.code !== 0 || !body.lyric) throw new Error('Get lyric failed')
  return {
    lyric: decodeName(b64DecodeUnicode(body.lyric)),
    tlyric: decodeName(b64DecodeUnicode(body.trans ?? '')),
  }
}

export default { getLyric: getTxLyric }
