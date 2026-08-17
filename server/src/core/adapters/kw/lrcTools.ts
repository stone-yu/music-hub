/**
 * kw 歌词解析工具 — 移植自上游 src/renderer/utils/musicSdk/kw/util.js 的 lrcTools@9c364b4
 * 负责把逐字歌词(lyricx)解析为 lx 逐字格式；保持逐字段对齐便于跟随上游。
 */
import { decodeName } from '../common.js'

interface WordInfo {
  startTime: number
  endTime: number
  timeStr: string
  newTimeStr?: string
}

export const lrcTools = {
  rxps: {
    wordLine: /^(\[\d{1,2}:.*\d{1,4}\])\s*(\S+(?:\s+\S+)*)?\s*/,
    tagLine: /\[(ver|ti|ar|al|offset|by|kuwo):\s*(\S+(?:\s+\S+)*)\s*\]/,
    wordTimeAll: /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g,
    wordTime: /<(-?\d+),(-?\d+)(?:,-?\d+)?>/,
  },
  offset: 1,
  offset2: 1,
  isOK: false,
  lines: [] as string[],
  tags: [] as string[],

  getWordInfo(str: string, str2: string, prevWord?: WordInfo): WordInfo {
    const offset = parseInt(str)
    const offset2 = parseInt(str2)
    const startTime = Math.abs((offset + offset2) / (this.offset * 2))
    const endTime = Math.abs((offset - offset2) / (this.offset2 * 2)) + startTime
    if (prevWord) {
      if (startTime < prevWord.endTime) {
        prevWord.endTime = startTime
        if (prevWord.startTime > prevWord.endTime) prevWord.startTime = prevWord.endTime
        prevWord.newTimeStr = `<${prevWord.startTime},${prevWord.endTime - prevWord.startTime}>`
      }
    }
    return { startTime, endTime, timeStr: `<${startTime},${endTime - startTime}>` }
  },

  parseLine(line: string): void {
    if (line.length < 6) return
    let result = this.rxps.wordLine.exec(line)
    if (result) {
      const time = result[1]
      let words = result[2]
      if (words == null) words = ''
      const wordTimes = words.match(this.rxps.wordTimeAll)
      if (!wordTimes) return
      let preTimeInfo: WordInfo | undefined
      for (const timeStr of wordTimes) {
        const r = this.rxps.wordTime.exec(timeStr)!
        const wordInfo = this.getWordInfo(r[1]!, r[2]!, preTimeInfo)
        words = words.replace(timeStr, wordInfo.timeStr)
        if (preTimeInfo?.newTimeStr) words = words.replace(preTimeInfo.timeStr, preTimeInfo.newTimeStr)
        preTimeInfo = wordInfo
      }
      this.lines.push(time + words)
      return
    }
    result = this.rxps.tagLine.exec(line)
    if (!result) return
    if (result[1] === 'kuwo') {
      let content = result[2]
      if (content != null && content.includes('][')) content = content.substring(0, content.indexOf(']['))
      const valueOf = parseInt(content!, 8)
      this.offset = Math.trunc(valueOf / 10)
      this.offset2 = Math.trunc(valueOf % 10)
      if (this.offset === 0 || Number.isNaN(this.offset) || this.offset2 === 0 || Number.isNaN(this.offset2)) this.isOK = false
    } else {
      this.tags.push(line)
    }
  },

  parse(lrc: string): string {
    const lines = lrc.split(/\r\n|\r|\n/)
    const tools = Object.create(this) as typeof lrcTools
    tools.isOK = true
    tools.offset = 1
    tools.offset2 = 1
    tools.lines = []
    tools.tags = []
    for (const line of lines) {
      if (!tools.isOK) throw new Error('failed')
      tools.parseLine(line)
    }
    if (!tools.lines.length) return ''
    let lrcs = tools.lines.join('\n')
    if (tools.tags.length) lrcs = `${tools.tags.join('\n')}\n${lrcs}`
    return lrcs
  },
}

export { decodeName }
