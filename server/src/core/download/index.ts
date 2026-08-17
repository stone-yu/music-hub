/**
 * 下载器 — 流式下载 + 进度 + 元数据嵌入
 *
 * 流程：orchestrator 取 URL → 流式下载到临时文件 → 探测格式 →
 *       嵌入封面(sharp 缩放) + 标签 + 歌词 → 落盘到最终路径。
 *
 * 元数据：MP3 用 node-id3；FLAC 用 flac-tagger。封面统一 sharp 缩放。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import needle from 'needle'
import sharp from 'sharp'
import NodeID3 from 'node-id3'
import { config } from '../config.js'
import { logger } from '../logger.js'
import type { MusicInfo } from '../adapters/common.js'
import type { Quality } from '../source-engine/lx-env.js'

export interface DownloadMeta {
  name: string
  singer: string
  album?: string
  coverUrl?: string | null
  lyric?: string | null
}

export interface DownloadProgress {
  (received: number, total: number, percent: number): void
}

export interface DownloadOutcome {
  filePath: string
  fileSize: number
  format: 'mp3' | 'flac' | 'unknown'
  warnings: string[]
}

/** 从 URL 猜扩展名/格式 */
function guessFormat(url: string, contentType?: string): { ext: string; format: 'mp3' | 'flac' | 'unknown' } {
  const lower = url.split('?')[0]!.toLowerCase()
  const ct = (contentType ?? '').toLowerCase()
  if (lower.endsWith('.flac') || ct.includes('flac')) return { ext: 'flac', format: 'flac' }
  if (lower.endsWith('.mp3') || ct.includes('mpeg')) return { ext: 'mp3', format: 'mp3' }
  if (lower.endsWith('.m4a') || ct.includes('mp4') || ct.includes('m4a')) return { ext: 'm4a', format: 'unknown' }
  if (lower.endsWith('.wav')) return { ext: 'wav', format: 'unknown' }
  return { ext: 'mp3', format: 'mp3' }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200)
}

function renderName(template: string, meta: DownloadMeta): string {
  return sanitizeFilename(
    template.replace(/\{name\}/g, meta.name).replace(/\{singer\}/g, meta.singer).replace(/\{album\}/g, meta.album ?? ''),
  )
}

/** 下载封面并用 sharp 缩放为指定尺寸 JPEG */
async function fetchCover(coverUrl: string, size: number): Promise<Buffer | null> {
  try {
    const resp = await needle('get', coverUrl, { response_timeout: 15_000, follow_max: 3 })
    const raw = resp.body as Buffer
    if (!Buffer.isBuffer(raw) || raw.length < 100) return null
    return await sharp(raw).resize(size, size, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer()
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '[download] cover fetch/resize failed')
    return null
  }
}

async function streamDownload(url: string, dest: string, onProgress?: DownloadProgress): Promise<{ contentType?: string }> {
  const stream = needle.get(url, { response_timeout: 30_000, read_timeout: 60_000, follow_max: 5 })
  let total = 0
  let received = 0
  let contentType: string | undefined

  stream.on('header', (statusCode: number, headers: Record<string, string>) => {
    if (statusCode >= 400) stream.emit('error', new Error(`HTTP ${statusCode}`))
    total = parseInt(headers['content-length'] ?? '0') || 0
    contentType = headers['content-type']
  })
  if (onProgress) {
    stream.on('data', (chunk: Buffer) => {
      received += chunk.length
      onProgress(received, total, total ? Math.floor((received / total) * 100) : 0)
    })
  }

  await pipeline(stream, fs.createWriteStream(dest))
  return { contentType }
}

/** MP3 标签嵌入 */
function embedMp3(filePath: string, meta: DownloadMeta, cover: Buffer | null): void {
  const tags: NodeID3.Tags = {
    title: meta.name,
    artist: meta.singer,
    album: meta.album,
  }
  if (meta.lyric) tags.unsynchronisedLyrics = { language: 'chi', text: meta.lyric }
  if (cover) tags.image = { mime: 'image/jpeg', type: { id: 3, name: 'front cover' }, description: 'cover', imageBuffer: cover }
  const ok = NodeID3.write(tags, filePath)
  if (ok !== true) throw new Error('node-id3 write failed')
}

/** FLAC 标签嵌入（动态 import flac-tagger，避免无 flac 下载时也加载） */
async function embedFlac(filePath: string, meta: DownloadMeta, cover: Buffer | null): Promise<void> {
  const { writeFlacTags } = await import('flac-tagger')
  const tagMap: Record<string, string> = {
    TITLE: meta.name,
    ARTIST: meta.singer,
  }
  if (meta.album) tagMap.ALBUM = meta.album
  if (meta.lyric) tagMap.LYRICS = meta.lyric
  await writeFlacTags(
    {
      tagMap,
      ...(cover ? { picture: { buffer: cover, mime: 'image/jpeg', description: 'cover' } } : {}),
    },
    filePath,
  )
}

export const downloader = {
  /**
   * 下载并嵌入元数据。part-fail 语义：下载成功但封面/标签失败 → warnings 非空。
   */
  async download(
    url: string,
    _quality: Quality,
    meta: DownloadMeta,
    musicInfo: MusicInfo,
    onProgress?: DownloadProgress,
  ): Promise<DownloadOutcome> {
    void musicInfo
    const warnings: string[] = []
    const dir = config.download.dir
    fs.mkdirSync(dir, { recursive: true })

    const baseName = renderName(config.download.nameTemplate, meta) || `${meta.name} - ${meta.singer}`

    // 先下到临时文件，拿到 content-type 再定扩展名
    const tmpPath = path.join(dir, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    let contentType: string | undefined
    try {
      const r = await streamDownload(url, tmpPath, onProgress)
      contentType = r.contentType
    } catch (err) {
      await fs.promises.rm(tmpPath, { force: true })
      throw new Error(`下载失败: ${(err as Error).message}`)
    }

    const { ext, format } = guessFormat(url, contentType)
    const finalPath = path.join(dir, `${baseName}.${ext}`)
    await fs.promises.rename(tmpPath, finalPath)

    // 封面
    let cover: Buffer | null = null
    if (config.download.embedCover && meta.coverUrl) {
      cover = await fetchCover(meta.coverUrl, config.download.coverSize)
      if (!cover) warnings.push('封面获取/处理失败')
    }
    const lyricMeta: DownloadMeta = { ...meta, lyric: config.download.embedLyric ? meta.lyric : null }

    // 标签
    try {
      if (format === 'mp3') embedMp3(finalPath, lyricMeta, cover)
      else if (format === 'flac') await embedFlac(finalPath, lyricMeta, cover)
      else warnings.push(`未知格式(${ext})，跳过标签嵌入`)
    } catch (err) {
      warnings.push(`标签嵌入失败: ${(err as Error).message}`)
      logger.warn({ err: (err as Error).message, finalPath }, '[download] tag embed failed')
    }

    const stat = await fs.promises.stat(finalPath)
    return { filePath: finalPath, fileSize: stat.size, format, warnings }
  },
}
