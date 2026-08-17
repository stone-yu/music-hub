/**
 * 歌词/封面元数据聚合入口
 *
 * 洛雪逻辑：歌词与封面不走音源（音源只给 musicUrl），而是走各平台官方接口。
 * 这里按 platform 路由到对应适配器。全部 best-effort，失败返回 null 不抛。
 *
 * 歌词：kw/kg/tx/wy/mg 均已实现。
 * 封面：
 *   - kw：artistpicserver 接口（搜索结果不带 img）
 *   - kg：get_res_privilege 接口（搜索结果不带 img）
 *   - tx/wy/mg：搜索结果 musicInfo.img 已是 500x500 直链，直接用
 */
import type { MusicInfo } from './common.js'
import { getKwLyric } from './kw/lyric.js'
import { getKwPic } from './kw/pic.js'
import { getKgLyric } from './kg/lyric.js'
import { getKgPic } from './kg/pic.js'
import { getTxLyric } from './tx/lyric.js'
import { getWyLyric } from './wy/lyric.js'
import { getMgLyric } from './mg/lyric.js'
import { logger } from '../logger.js'

export interface LyricResult {
  lyric: string
  tlyric?: string
  rlyric?: string
  lxlyric?: string
}

/** 取歌词（best-effort，失败返回 null 不抛） */
export async function fetchLyric(platform: string, musicInfo: MusicInfo): Promise<LyricResult | null> {
  try {
    switch (platform) {
      case 'kw':
        return await getKwLyric(musicInfo.songmid)
      case 'kg':
        return await getKgLyric(musicInfo)
      case 'tx':
        return await getTxLyric(musicInfo.songmid)
      case 'wy':
        return await getWyLyric(musicInfo.songmid)
      case 'mg':
        return await getMgLyric(musicInfo)
      default:
        return null
    }
  } catch (err) {
    logger.warn({ platform, songmid: musicInfo.songmid, err: (err as Error).message }, '[metadata] lyric fetch failed')
    return null
  }
}

/** 取封面 URL（best-effort，失败返回 null 不抛） */
export async function fetchCoverUrl(platform: string, musicInfo: MusicInfo): Promise<string | null> {
  // 搜索结果自带封面直链就优先用（tx/wy/mg 都带）
  if (musicInfo.img && /^https?:/.test(musicInfo.img)) return musicInfo.img
  try {
    switch (platform) {
      case 'kw':
        return await getKwPic(musicInfo.songmid)
      case 'kg':
        return await getKgPic(musicInfo)
      default:
        return null
    }
  } catch (err) {
    logger.warn({ platform, songmid: musicInfo.songmid, err: (err as Error).message }, '[metadata] cover fetch failed')
    return null
  }
}
