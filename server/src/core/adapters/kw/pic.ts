/**
 * kw 封面适配器 — 移植自上游 src/renderer/utils/musicSdk/kw/pic.js@9c364b4
 * 请求 artistpicserver.kuwo.cn，返回图片 URL（响应体本身就是一个 http 链接字符串）。
 */
import needle from 'needle'

export async function getKwPic(songmid: string | number): Promise<string | null> {
  const url = `http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${songmid}`
  return new Promise((resolve) => {
    needle.get(url, { response_timeout: 15_000, follow_max: 3, parse_response: false }, (err, resp) => {
      if (err) return resolve(null)
      const body = (Buffer.isBuffer(resp.body) ? resp.body.toString() : String(resp.body)).trim()
      resolve(/^http/.test(body) ? body : null)
    })
  })
}

export default { getPic: getKwPic }
