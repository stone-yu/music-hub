/**
 * 冒烟测试引擎（R9）— 每音源×每平台走真实最小链路：
 *   search → musicUrl(128k) → HEAD 探测 → lyric/pic(可选)
 *
 * 关键约束（照 R9 需求）：
 *  - 复用与正常下载相同的适配器/音源调用，测的就是真实链路
 *  - 平台之间串行、间隔 ≥3s 防风控
 *  - 结果落 smoke_results；连续失败≥阈值触发 Bark/Server酱告警
 *  - 通过事件总线发 smoke:completed / smoke:failed，供 SSE 广播
 */
import { randomUUID } from 'node:crypto'
import needle from 'needle'
import { sourceEngine } from '../source-engine/index.js'
import { searchService, isPlatform, type Platform } from '../search/index.js'
import { fetchLyric, fetchCoverUrl } from '../adapters/metadata.js'
import { smokeStore, type SmokeResultRow } from '../db/smoke.js'
import { notify } from '../notify/index.js'
import { emitEvent } from '../events.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface SmokeRunSummary {
  runId: string
  startedAt: number
  finishedAt: number
  total: number
  passed: number
  failed: number
  cells: { sourceId: string; platform: string; ok: boolean; failedStep?: string; error?: string }[]
}

let running = false

/** HEAD/Range 探测：断言 2xx 且有内容 */
async function probeUrl(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!/^https?:\/\//.test(url)) return { ok: false, error: 'not http url' }
    const resp = await needle('head', url, { response_timeout: 12_000, follow_max: 3 })
    const len = Number(resp.headers['content-length'] ?? 0)
    if ((resp.statusCode ?? 0) >= 200 && (resp.statusCode ?? 0) < 400 && (len > 0 || resp.headers['content-length'] == null)) {
      return { ok: true }
    }
    return { ok: false, error: `HTTP ${resp.statusCode} len=${len}` }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** 跑一轮冒烟测试 */
export async function runSmokeTest(): Promise<SmokeRunSummary> {
  if (running) throw new Error('冒烟测试已在运行中')
  running = true
  const runId = randomUUID()
  const startedAt = Date.now()
  const keyword = config.smokeTest.keyword || '周杰伦'
  const rows: SmokeResultRow[] = []
  const cells: SmokeRunSummary['cells'] = []

  try {
    const sources = sourceEngine.list().filter((s) => s.status === 'ready' && s.enabled)
    logger.info({ runId, sources: sources.length }, '[smoke] start')

    let firstCell = true
    for (const src of sources) {
      const platforms = Object.keys(src.sources).filter((p) => isPlatform(p)) as Platform[]
      for (const platform of platforms) {
        // 平台间串行 + 间隔 ≥3s 防风控
        if (!firstCell) await sleep(3000)
        firstCell = false

        let cellOk = true
        let failedStep: string | undefined
        let cellErr: string | undefined
        let firstResult: { musicInfo: unknown } | null = null

        // 1) search
        let t = Date.now()
        try {
          const r = await searchService.searchPlatform(platform, keyword, 1, 5)
          if (!r.list.length) throw new Error('无搜索结果')
          firstResult = { musicInfo: r.list[0] }
          rows.push(smokeStore.newRow(runId, src.id, platform, 'search', true, Date.now() - t))
        } catch (err) {
          rows.push(smokeStore.newRow(runId, src.id, platform, 'search', false, Date.now() - t, (err as Error).message))
          cellOk = false; failedStep = 'search'; cellErr = (err as Error).message
        }

        // 2) musicUrl(128k) + 3) HEAD
        if (firstResult) {
          t = Date.now()
          let url: string | null = null
          try {
            url = await sourceEngine.getMusicUrlExact(src.id, platform, firstResult.musicInfo, '128k')
            rows.push(smokeStore.newRow(runId, src.id, platform, 'musicUrl', true, Date.now() - t))
          } catch (err) {
            rows.push(smokeStore.newRow(runId, src.id, platform, 'musicUrl', false, Date.now() - t, (err as Error).message))
            cellOk = false; failedStep ??= 'musicUrl'; cellErr ??= (err as Error).message
          }
          if (url) {
            t = Date.now()
            const probe = await probeUrl(url)
            rows.push(smokeStore.newRow(runId, src.id, platform, 'head', probe.ok, Date.now() - t, probe.error))
            if (!probe.ok) { cellOk = false; failedStep ??= 'head'; cellErr ??= probe.error }
          }

          // 4) lyric / pic（可选，失败不致命，但记录）
          if (config.smokeTest.checkLyric) {
            t = Date.now()
            const ly = await fetchLyric(platform, firstResult.musicInfo as never)
            rows.push(smokeStore.newRow(runId, src.id, platform, 'lyric', !!ly?.lyric, Date.now() - t, ly?.lyric ? undefined : '无歌词'))
          }
          if (config.smokeTest.checkPic) {
            t = Date.now()
            const pic = await fetchCoverUrl(platform, firstResult.musicInfo as never)
            rows.push(smokeStore.newRow(runId, src.id, platform, 'pic', !!pic, Date.now() - t, pic ? undefined : '无封面'))
          }
        }

        cells.push({ sourceId: src.id, platform, ok: cellOk, failedStep, error: cellErr })
      }
    }

    smokeStore.insertMany(rows)

    const passed = cells.filter((c) => c.ok).length
    const summary: SmokeRunSummary = {
      runId, startedAt, finishedAt: Date.now(),
      total: cells.length, passed, failed: cells.length - passed, cells,
    }

    // 告警：对失败的 cell，检查是否连续失败≥阈值
    await checkAndAlert(cells)

    emitEvent('smoke:completed', { runId, total: summary.total, passed, failed: summary.failed })
    logger.info({ runId, passed, failed: summary.failed }, '[smoke] done')
    return summary
  } catch (err) {
    emitEvent('smoke:failed', { runId, error: (err as Error).message })
    logger.error({ runId, err: (err as Error).message }, '[smoke] run error')
    throw err
  } finally {
    running = false
  }
}

/** 连续失败判定 + 告警 */
async function checkAndAlert(cells: SmokeRunSummary['cells']): Promise<void> {
  const threshold = config.smokeTest.alertThreshold || 2
  const alertLines: string[] = []
  for (const cell of cells) {
    if (cell.ok) continue
    // 取最近 threshold 次 run（含本次已入库）的整体结果，全失败才告警
    const recent = smokeStore.recentRunsOutcome(cell.sourceId, cell.platform, threshold)
    if (recent.length >= threshold && recent.every((ok) => !ok)) {
      alertLines.push(`❌ ${cell.sourceId} / ${cell.platform}：连续 ${recent.length} 次失败（${cell.failedStep}: ${cell.error ?? ''}）`)
    }
  }
  if (alertLines.length) {
    const title = `Ro 冒烟告警：${alertLines.length} 个平台异常`
    const body = alertLines.join('\n')
    await notify(title, body)
    emitEvent('smoke:alert', { count: alertLines.length, lines: alertLines })
  }
}

export function isSmokeRunning(): boolean {
  return running
}
