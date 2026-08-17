/**
 * 健康状态路由（R9）
 *   GET  /api/v1/health/smoke        最近一次冒烟结果 + 平台×音源矩阵
 *   GET  /api/v1/health/smoke/trend  最近 N 天趋势（?days=7）
 *   POST /api/v1/health/smoke/run    手动触发一次冒烟测试
 */
import type { FastifyInstance } from 'fastify'
import { smokeStore } from '../core/db/smoke.js'
import { runSmokeTest, isSmokeRunning } from '../core/smoke/index.js'

/** 把最近一次 run 的逐步骤结果聚合为 音源×平台 矩阵单元格 */
function buildMatrix(rows: ReturnType<typeof smokeStore.latestRun>) {
  const cellMap = new Map<string, { sourceId: string; platform: string; steps: Record<string, { ok: boolean; ms: number; error: string | null }>; ok: boolean }>()
  for (const r of rows) {
    const key = `${r.source_id}||${r.platform}`
    let cell = cellMap.get(key)
    if (!cell) {
      cell = { sourceId: r.source_id, platform: r.platform, steps: {}, ok: true }
      cellMap.set(key, cell)
    }
    cell.steps[r.step] = { ok: r.ok === 1, ms: r.ms, error: r.error }
    // 关键步骤（search/musicUrl/head）失败 → 该 cell 红；lyric/pic 失败仅黄
    if (['search', 'musicUrl', 'head'].includes(r.step) && r.ok !== 1) cell.ok = false
  }
  const cells = [...cellMap.values()].map((c) => {
    const optionalFail = ['lyric', 'pic'].some((s) => c.steps[s] && !c.steps[s]!.ok)
    const state = !c.ok ? 'red' : optionalFail ? 'yellow' : 'green'
    return { ...c, state }
  })
  return cells
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/health/smoke', async () => {
    const rows = smokeStore.latestRun()
    const cells = buildMatrix(rows)
    const runId = rows[0]?.run_id ?? null
    const lastRunAt = rows.length ? Math.max(...rows.map((r) => r.created_at)) : null
    return {
      runId,
      lastRunAt,
      running: isSmokeRunning(),
      summary: {
        total: cells.length,
        green: cells.filter((c) => c.state === 'green').length,
        yellow: cells.filter((c) => c.state === 'yellow').length,
        red: cells.filter((c) => c.state === 'red').length,
      },
      cells,
    }
  })

  app.get<{ Querystring: { days?: string } }>('/api/v1/health/smoke/trend', async (req) => {
    const days = Math.min(Math.max(parseInt(req.query.days ?? '7') || 7, 1), 30)
    return { days, trend: smokeStore.trend(days) }
  })

  app.post('/api/v1/health/smoke/run', async (req, reply) => {
    if (isSmokeRunning()) return reply.code(409).send({ error: '冒烟测试已在运行中' })
    // 异步跑，立即返回（前端用 SSE/轮询看结果）
    void runSmokeTest().catch(() => {})
    return reply.code(202).send({ started: true })
  })
}
