/**
 * 网易云 eapi 加密 — 移植自上游 src/renderer/utils/musicSdk/wy/utils/crypto.js@9c364b4
 * 仅移植服务端搜索/取URL 实际用到的 eapi（AES-128-ECB + MD5 摘要）
 */
import { createCipheriv, createDecipheriv, createHash, publicEncrypt, randomBytes, constants } from 'node:crypto'

const eapiKey = Buffer.from('e82ckenh8dichen8')
const linuxapiKey = Buffer.from('rFgB&h#%2?^eDg:Q')
const iv = Buffer.from('0102030405060708')
const presetKey = Buffer.from('0CoJUm6Qyw8W8jud')
const base62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const publicKey = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----'

function aesEncrypt(buffer: Buffer, mode: string, key: Buffer, iv: Buffer | null): Buffer {
  const cipher = createCipheriv(mode, key, iv)
  return Buffer.concat([cipher.update(buffer), cipher.final()])
}

export interface EapiForm {
  params: string
}

export function eapi(url: string, object: unknown): EapiForm {
  const text = typeof object === 'object' ? JSON.stringify(object) : String(object)
  const message = `nobody${url}use${text}md5forencrypt`
  const digest = createHash('md5').update(message).digest('hex')
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  return {
    params: aesEncrypt(Buffer.from(data), 'aes-128-ecb', eapiKey, null).toString('hex').toUpperCase(),
  }
}

export function eapiDecrypt(cipherBuffer: Buffer): string {
  const decipher = createDecipheriv('aes-128-ecb', eapiKey, null)
  return Buffer.concat([decipher.update(cipherBuffer), decipher.final()]).toString()
}

export interface LinuxApiForm {
  eparams: string
}

/** 网易云 linuxapi 加密（AES-128-ECB，用于 /api/linux/forward 转发歌单详情） */
export function linuxapi(object: unknown): LinuxApiForm {
  const text = JSON.stringify(object)
  return {
    eparams: aesEncrypt(Buffer.from(text), 'aes-128-ecb', linuxapiKey, null).toString('hex').toUpperCase(),
  }
}

export interface WeapiForm {
  params: string
  encSecKey: string
}

function rsaEncrypt(buffer: Buffer, key: string): Buffer {
  const padded = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer])
  return publicEncrypt({ key, padding: constants.RSA_NO_PADDING }, padded)
}

/** 网易云 weapi 加密（双层 AES-128-CBC + RSA，用于 song/detail 补齐大歌单） */
export function weapi(object: unknown): WeapiForm {
  const text = JSON.stringify(object)
  const secretKey = randomBytes(16).map((n) => base62.charCodeAt(n % 62))
  const first = aesEncrypt(Buffer.from(text), 'aes-128-cbc', presetKey, iv).toString('base64')
  return {
    params: aesEncrypt(Buffer.from(first), 'aes-128-cbc', Buffer.from(secretKey), iv).toString('base64'),
    encSecKey: rsaEncrypt(Buffer.from(secretKey).reverse(), publicKey).toString('hex'),
  }
}
