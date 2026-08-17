/**
 * mg mrc 歌词解密（TEA/XXTEA 变体）— 移植自上游 src/renderer/utils/musicSdk/mg/utils/mrc.js@9c364b4
 * 纯 BigInt 实现，无原生依赖。
 */
const DELTA = 2654435769n
const MIN_LENGTH = 32
const keyArr = [
  27303562373562475n,
  18014862372307051n,
  22799692160172081n,
  34058940340699235n,
  30962724186095721n,
  27303523720101991n,
  27303523720101998n,
  31244139033526382n,
  28992395054481524n,
]

const MAX = 9223372036854775807n
const MIN = -9223372036854775808n
function toLong(str: string | bigint): bigint {
  const num = typeof str === 'string' ? BigInt('0x' + str) : str
  if (num > MAX) return toLong(num - (1n << 64n))
  else if (num < MIN) return toLong(num + (1n << 64n))
  return num
}

function teaDecrypt(data: bigint[], key: bigint[]): bigint[] {
  const length = data.length
  const lengthBigint = BigInt(length)
  if (length >= 1) {
    let j2 = data[0]!
    let j3 = toLong((6n + 52n / lengthBigint) * DELTA)
    while (true) {
      const j4 = j3
      if (j4 === 0n) break
      const j5 = toLong(3n & toLong(j4 >> 2n))
      let j6 = lengthBigint
      while (true) {
        j6--
        if (j6 > 0n) {
          const j7 = data[Number(j6 - 1n)]!
          const i = Number(j6)
          j2 = toLong(
            data[i]! -
              (toLong(toLong(j2 ^ j4) + toLong(j7 ^ key[Number(toLong(toLong(3n & j6) ^ j5))]!)) ^
                toLong(toLong(toLong(j7 >> 5n) ^ toLong(j2 << 2n)) + toLong(toLong(j2 >> 3n) ^ toLong(j7 << 4n)))),
          )
          data[i] = j2
        } else break
      }
      const j8 = data[Number(lengthBigint - 1n)]!
      j2 = toLong(
        data[0]! -
          toLong(
            toLong(toLong(key[Number(toLong(toLong(j6 & 3n) ^ j5))]! ^ j8) + toLong(j2 ^ j4)) ^
              toLong(toLong(toLong(j8 >> 5n) ^ toLong(j2 << 2n)) + toLong(toLong(j2 >> 3n) ^ toLong(j8 << 4n))),
          ),
      )
      data[0] = j2
      j3 = toLong(j4 - DELTA)
    }
  }
  return data
}

function longToBytes(l: bigint): Buffer {
  const result = Buffer.alloc(8)
  for (let i = 0; i < 8; i++) {
    result[i] = Number(l & 0xffn)
    l >>= 8n
  }
  return result
}

function longArrToString(data: bigint[]): string {
  const arrayList: string[] = []
  for (const j of data) arrayList.push(longToBytes(j).toString('utf16le'))
  return arrayList.join('')
}

function toBigintArray(data: string): bigint[] {
  const length = Math.floor(data.length / 16)
  const jArr: bigint[] = new Array(length)
  for (let i = 0; i < length; i++) {
    jArr[i] = toLong(data.substring(i * 16, i * 16 + 16))
  }
  return jArr
}

export function decrypt(data: string): string {
  return data == null || data.length < MIN_LENGTH ? data : longArrToString(teaDecrypt(toBigintArray(data), keyArr))
}
