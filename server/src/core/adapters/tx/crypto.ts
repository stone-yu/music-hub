/**
 * QQ音乐 zzc 签名 — 移植自上游 src/renderer/utils/musicSdk/tx/utils/crypto.js@9c364b4
 */
import crypto from 'node:crypto'

const PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19]
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5]
const SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179]

function hashSHA1(data: string): string {
  return crypto.createHash('sha1').update(data).digest('hex')
}

function pickHashByIdx(hash: string, indexes: number[]): string {
  return indexes.map((idx) => hash[idx]).join('')
}

function base64Encode(data: number[]): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/[\\/+=]/g, '')
}

export function zzcSign(text: string): string {
  const hash = hashSHA1(text)
  const part1 = pickHashByIdx(hash, PART_1_INDEXES)
  const part2 = pickHashByIdx(hash, PART_2_INDEXES)
  const part3 = SCRAMBLE_VALUES.map((value, i) => value ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16))
  const b64Part = base64Encode(part3).replace(/[\\/+=]/g, '')
  return `zzc${part1}${b64Part}${part2}`.toLowerCase()
}
