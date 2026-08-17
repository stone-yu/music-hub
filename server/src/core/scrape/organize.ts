/**
 * 刮削整理：把下载好的文件按 艺术家/专辑 目录归类移动。
 *
 * 目录结构：{targetDir}/{safeArtist}/{safeAlbum}/{safeTitle} - {safeArtist}{ext}
 * safeDirName 去非法字符 [\\/:*?"<>|] 截 80 字符，空则 Unknown。
 * 重名加 _{i} 序号。移动用 rename（同卷原子），跨卷 fallback copy+rm。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 清理目录/文件名非法字符，截断 80 字符，空则 Unknown */
export function safeDirName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '').trim()
  return (cleaned.slice(0, 80) || 'Unknown')
}

/** 构建目标路径（不实际移动），重名加序号 */
export function buildTargetPath(filePath: string, name: string, singer: string, album: string, targetDir: string): string {
  const artistDir = safeDirName(singer || 'Unknown')
  const albumDir = safeDirName(album || 'Unknown')
  const ext = path.extname(filePath) || '.mp3'
  const baseName = `${safeDirName(name)} - ${safeDirName(singer)}${ext}`
  let target = path.join(targetDir, artistDir, albumDir, baseName)
  // 重名加序号（避免覆盖已有文件）
  if (fs.existsSync(target) && path.resolve(filePath) !== path.resolve(target)) {
    const parsed = path.parse(target)
    let i = 1
    while (fs.existsSync(path.join(parsed.dir, `${parsed.name}_${i}${parsed.ext}`))) i++
    target = path.join(parsed.dir, `${parsed.name}_${i}${parsed.ext}`)
  }
  return target
}

/**
 * 整理文件：移动到 {targetDir}/{artist}/{album}/ 下。
 * 返回 { targetPath, targetDir }。
 */
export async function organizeFile(
  filePath: string,
  name: string,
  singer: string,
  album: string,
  targetDir: string,
): Promise<{ targetPath: string; targetDir: string }> {
  const targetPath = buildTargetPath(filePath, name, singer, album, targetDir)
  const targetFileDir = path.dirname(targetPath)
  fs.mkdirSync(targetFileDir, { recursive: true })
  try {
    await fs.promises.rename(filePath, targetPath)
  } catch {
    // 跨卷 rename 失败时 fallback copy + rm
    await fs.promises.copyFile(filePath, targetPath)
    await fs.promises.rm(filePath, { force: true })
  }
  return { targetPath, targetDir: targetFileDir }
}
