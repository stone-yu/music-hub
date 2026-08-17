/**
 * 冒烟测试结果持久化（R9）— 复用 db/index.ts 的 better-sqlite3 连接。
 *
 * smoke_results：每次冒烟对「音源×平台」逐步骤记录结果。
 * 健康页据此渲染平台×音源矩阵 + 7 天趋势；告警据「连续失败次数」判定。
 */
import { randomUUID } from 'node:crypto'
import { initDb } from './index.js'

export type SmokeStep = 'search' | 'musicUrl' | 'head' | 'lyric' | 'pic'

export interface SmokeResultRow {
  id: string
  run_id: string
  source_id: string
  platform: string
  step: SmokeStep
  ok: number // 0/1
  ms: number
  error: string | null
  created_at: number
}

let inited = false
function ensureTable(): void {
  if (inited) return
  const db = initDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS smoke_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      step TEXT NOT NULL,
      ok INTEGER NOT NULL,
      ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_smoke_run ON smoke_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_smoke_created ON smoke_results(created_at);
    CREATE INDEX IF NOT EXISTS idx_smoke_sp ON smoke_results(source_id, platform, created_at);
  `)
  inited = true
}

export const smokeStore = {
  insertMany(rows: SmokeResultRow[]): void {
    ensureTable()
    const db = initDb()
    const stmt = db.prepare(
      `INSERT INTO smoke_results (id, run_id, source_id, platform, step, ok, ms, error, created_at)
       VALUES (@id, @run_id, @source_id, @platform, @step, @ok, @ms, @error, @created_at)`,
    )
    const tx = db.transaction((list: SmokeResultRow[]) => {
      for (const r of list) stmt.run(r)
    })
    tx(rows)
  },

  newRow(runId: string, sourceId: string, platform: string, step: SmokeStep, ok: boolean, ms: number, error?: string): SmokeResultRow {
    return {
      id: randomUUID(),
      run_id: runId,
      source_id: sourceId,
      platform,
      step,
      ok: ok ? 1 : 0,
      ms,
      error: error ?? null,
      created_at: Date.now(),
    }
  },

  /** 最近一次 run 的所有结果 */
  latestRun(): SmokeResultRow[] {
    ensureTable()
    const db = initDb()
    const last = db.prepare('SELECT run_id FROM smoke_results ORDER BY created_at DESC LIMIT 1').get() as { run_id: string } | undefined
    if (!last) return []
    return db.prepare('SELECT * FROM smoke_results WHERE run_id = ? ORDER BY created_at ASC').all(last.run_id) as SmokeResultRow[]
  },

  /** 某音源×平台最近 N 次 run 的整体成败（用于连续失败判定） */
  recentRunsOutcome(sourceId: string, platform: string, limit: number): boolean[] {
    ensureTable()
    const db = initDb()
    // 取该 source/platform 最近的若干 run，按 run 聚合：任一步骤失败即该 run 失败
    const rows = db.prepare(
      `SELECT run_id, MIN(ok) AS all_ok, MAX(created_at) AS ts
       FROM smoke_results WHERE source_id = ? AND platform = ?
       GROUP BY run_id ORDER BY ts DESC LIMIT ?`,
    ).all(sourceId, platform, limit) as { run_id: string; all_ok: number }[]
    return rows.map((r) => r.all_ok === 1)
  },

  /** 最近 days 天，按天×平台聚合的成功率（健康趋势） */
  trend(days: number): { day: string; platform: string; total: number; ok: number }[] {
    ensureTable()
    const since = Date.now() - days * 86400_000
    const db = initDb()
    return db.prepare(
      `SELECT date(created_at/1000,'unixepoch','localtime') AS day, platform,
              COUNT(*) AS total, SUM(ok) AS ok
       FROM smoke_results WHERE created_at >= ? AND step = 'head'
       GROUP BY day, platform ORDER BY day DESC`,
    ).all(since) as { day: string; platform: string; total: number; ok: number }[]
  },
}
