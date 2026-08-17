/**
 * 音源编排器 — 多音源音质聚合（用户新需求，决策第 5 条）
 *
 * 策略：一个「主音源」 + 多个「补充音源」。
 * 对目标音质，先横向遍历所有音源（主 → 补充依次尝试）；
 * 全部失败才整体降一级音质，再横向遍历一遍；如此直到最低音质。
 *
 * 与底层 source-engine.getMusicUrl 的区别：
 *   - getMusicUrl 是「单音源」内部的音质降级链（底层能力，保留）
 *   - orchestrator 是「跨音源」的同音质横向聚合（上层编排）
 *
 * 命中即返回，并记录：实际音源 id、实际音质。
 */
import { sourceEngine, QUALITY_FALLBACK } from '../source-engine/index.js'
import type { Quality } from '../source-engine/lx-env.js'
import { findMusic } from '../adapters/match.js'
import type { MusicInfo } from '../adapters/common.js'
import { logger } from '../logger.js'

export interface ResolveResult {
  url: string
  quality: Quality // 实际命中的音质
  sourceId: string // 实际命中的音源脚本 id
  platform: string // 实际命中的平台（换源后可能不同于请求）
  musicInfo: unknown // 实际命中的歌曲对象（换源后为其它平台的版本）
  toggled: boolean // 是否通过跨平台换源命中（洛雪 toggleSource 行为）
}

export interface ResolveAttempt {
  quality: Quality
  sourceId: string
  ok: boolean
  error?: string
  platform?: string // 该尝试针对的平台（换源后与原平台不同）
  toggled?: boolean // 是否为跨平台换源尝试
}

export interface ResolveOptions {
  /** 目标平台（歌曲来源平台，如 kw/tx/wy...） */
  platform: string
  /** 搜索适配器产出的歌曲对象，原样透传 */
  musicInfo: unknown
  /** 期望音质（起点，从这里开始向下降级） */
  quality: Quality
  /** 显式指定主音源 id；不传则用引擎里第一个 ready 的音源 */
  primarySourceId?: string
  /** 显式指定候选音源顺序；不传则自动：主音源 + 其余 ready 音源 */
  sourceIds?: string[]
  /**
   * 主平台全部失败后，是否允许跨平台换源（findMusic 到其它平台的同款歌曲）。
   * 对齐洛雪 allowToggleSource，默认开启。
   */
  allowToggleSource?: boolean
  /** 换源匹配所需的原曲信息（name/singer/albumName/interval）。不传则从 musicInfo 提取。 */
  matchHint?: { name?: string; singer?: string; albumName?: string; interval?: string | 0 }
}

/**
 * 决定候选音源顺序：主音源在前，其余 ready 且启用的音源在后。
 * 仅纳入「声明支持该平台」的音源。
 */
function resolveSourceOrder(platform: string, primarySourceId?: string, explicit?: string[]): string[] {
  const all = sourceEngine
    .list()
    .filter((s) => s.status === 'ready' && s.enabled && s.sources[platform])
    .map((s) => s.id)

  if (explicit && explicit.length) {
    // 仅保留有效的（存在且支持该平台）
    return explicit.filter((id) => all.includes(id))
  }

  if (primarySourceId && all.includes(primarySourceId)) {
    return [primarySourceId, ...all.filter((id) => id !== primarySourceId)]
  }
  return all
}

/** 某音源某平台实际支持的音质集合 */
function supportedQualities(sourceId: string, platform: string): Quality[] {
  const rec = sourceEngine.get(sourceId)
  return rec?.sources[platform]?.qualitys ?? []
}

/**
 * 对某个「平台 + 歌曲对象」跑一遍「同音质横向遍历所有音源，全失败才降级」。
 * 命中返回结果；全部失败返回 null。尝试轨迹追加进 attempts。
 */
async function resolveForPlatform(
  platform: string,
  musicInfo: unknown,
  qualityChain: Quality[],
  order: string[],
  attempts: ResolveAttempt[],
  toggled: boolean,
): Promise<ResolveResult | null> {
  for (const q of qualityChain) {
    // 同一音质：横向遍历所有候选音源
    for (const sourceId of order) {
      // 该音源根本不支持这个音质就跳过（不算失败尝试）
      if (!supportedQualities(sourceId, platform).includes(q)) continue
      try {
        // 关键：用底层「精确取指定音质」（getMusicUrlExact，不降级），
        // 因为跨音源的降级次序由编排器统一掌控。
        const url = await sourceEngine.getMusicUrlExact(sourceId, platform, musicInfo, q)
        attempts.push({ quality: q, sourceId, ok: true, platform, toggled })
        logger.info({ platform, quality: q, sourceId, toggled }, '[orchestrator] hit')
        return { url, quality: q, sourceId, platform, musicInfo, toggled }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        attempts.push({ quality: q, sourceId, ok: false, error, platform, toggled })
        logger.warn({ platform, quality: q, sourceId, error, toggled }, '[orchestrator] miss, try next source')
      }
    }
    logger.warn({ platform, quality: q, toggled }, '[orchestrator] all sources failed at this quality, downgrading')
  }
  return null
}

/** 从 musicInfo 或 matchHint 提取换源匹配所需的原曲信息 */
function buildMatchQuery(opts: ResolveOptions): { name: string; singer: string; albumName?: string; interval?: string | 0; source: string } {
  const mi = (opts.musicInfo ?? {}) as Partial<MusicInfo>
  const h = opts.matchHint ?? {}
  return {
    name: h.name ?? mi.name ?? '',
    singer: h.singer ?? mi.singer ?? '',
    albumName: h.albumName ?? mi.albumName,
    interval: h.interval ?? mi.interval,
    source: opts.platform,
  }
}

export const orchestrator = {
  /**
   * 取 URL 两段式（对齐洛雪 handleGetOnlineMusicUrl）：
   *   1. 主平台：同音质横向遍历所有音源，全失败才降级
   *   2. 兜底：主平台彻底失败且 allowToggleSource 时，findMusic 跨平台找同款歌曲，
   *      逐个候选平台重复第 1 步，直到命中
   * 返回命中结果 + 完整尝试轨迹（写入任务记录用）。
   */
  async resolveUrl(opts: ResolveOptions): Promise<{ result: ResolveResult; attempts: ResolveAttempt[] }> {
    const order = resolveSourceOrder(opts.platform, opts.primarySourceId, opts.sourceIds)
    if (order.length === 0) {
      throw new Error(`没有可用音源支持平台 ${opts.platform}（需要已加载/启用/ready 且声明支持该平台的音源）`)
    }

    // 音质降级起点
    const startIdx = QUALITY_FALLBACK.indexOf(opts.quality)
    const qualityChain = QUALITY_FALLBACK.slice(startIdx === -1 ? 0 : startIdx)

    const attempts: ResolveAttempt[] = []

    // 第 1 段：主平台
    const primary = await resolveForPlatform(opts.platform, opts.musicInfo, qualityChain, order, attempts, false)
    if (primary) return { result: primary, attempts }

    // 第 2 段：跨平台换源兜底
    const allowToggle = opts.allowToggleSource !== false
    if (allowToggle) {
      const query = buildMatchQuery(opts)
      if (query.name) {
        logger.info({ platform: opts.platform, name: query.name, singer: query.singer }, '[orchestrator] primary failed, toggling source via findMusic')
        let candidates: MusicInfo[] = []
        try {
          candidates = await findMusic(query)
        } catch (err) {
          logger.warn({ err: (err as Error).message }, '[orchestrator] findMusic failed')
        }
        const retriedPlatforms = new Set<string>([opts.platform])
        for (const cand of candidates) {
          const candPlatform = String(cand.source)
          if (retriedPlatforms.has(candPlatform)) continue // 每平台只试一次（对齐上游 retryedSource）
          retriedPlatforms.add(candPlatform)
          const candOrder = resolveSourceOrder(candPlatform, opts.primarySourceId, opts.sourceIds)
          if (candOrder.length === 0) continue
          logger.info({ from: opts.platform, to: candPlatform, name: cand.name, singer: cand.singer, interval: cand.interval }, '[orchestrator] try toggle to')
          const hit = await resolveForPlatform(candPlatform, cand, qualityChain, candOrder, attempts, true)
          if (hit) return { result: hit, attempts }
        }
      } else {
        logger.warn('[orchestrator] no name for findMusic, skip toggle')
      }
    }

    const err = new Error(`所有音源在所有音质均未取到 URL（platform=${opts.platform}${allowToggle ? '，跨平台换源亦失败' : ''}）`)
    ;(err as Error & { attempts?: ResolveAttempt[] }).attempts = attempts
    throw err
  },
}
