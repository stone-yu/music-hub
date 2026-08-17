/**
 * kw 歌词解码 — 移植自上游 src/main/modules/winMain/rendererEvent/kw_decodeLyric.ts@9c364b4
 *
 * 上游把这段放在主进程（Electron main）里做，无头环境下我们直接在适配器内完成：
 *   1. 校验响应头以 'tp=content' 开头
 *   2. 取 \r\n\r\n 之后的负载，zlib inflate
 *   3. isGetLyricx 时再做 yeelion 异或
 *   4. gb18030 解码（iconv-lite）
 */
import { inflate } from 'node:zlib'
import iconv from 'iconv-lite'

function handleInflate(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    inflate(data, (err, result) => (err ? reject(err) : resolve(result)))
  })
}

const buf_key = Buffer.from('yeelion')
const buf_key_len = buf_key.length

export async function decodeKwLyric(buf: Buffer, isGetLyricx: boolean): Promise<string> {
  if (buf.toString('utf8', 0, 10) !== 'tp=content') return ''
  const lrcData = await handleInflate(buf.subarray(buf.indexOf('\r\n\r\n') + 4))

  if (!isGetLyricx) return iconv.decode(lrcData, 'gb18030')

  const buf_str = Buffer.from(lrcData.toString(), 'base64')
  const buf_str_len = buf_str.length
  const output = new Uint8Array(buf_str_len)
  let i = 0
  while (i < buf_str_len) {
    let j = 0
    while (j < buf_key_len && i < buf_str_len) {
      output[i] = buf_str[i]! ^ buf_key[j]!
      i++
      j++
    }
  }
  return iconv.decode(Buffer.from(output), 'gb18030')
}
