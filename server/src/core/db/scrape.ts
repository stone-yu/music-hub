/**
 * 刮削任务持久化层 — 复用 db/index.ts 的同一个 better-sqlite3 连接。
 *
 * 独立表 scrape_tasks，不动 download_tasks（避免对已有生产库做 ALTER TABLE 迁移）。
 * 通过 download_task_id 外键关联下载任务（可为 null，表示手动整理的游离文件）。
 *
 * 状态机：pending → organizing → organized → scanning → done
 *         失败分支 → failed（任意阶段异常）
 *         跳过分支 → skipped（配置关闭 / 无文件）
 */
import { randomUUID } from 'node:crypto'
import { initDb } from './index.js'

export type ScrapeStatus =
  | 'pending'
  | 'organizing'
  | 'organized'
  | 'scanning'
  | 'done'
  | 'failed'
  | 'skipped'

export interface ScrapeTaskRow {
  id: string
  download_task_id: string | null
  file_path: string
  name: string
  singer: string
  album: string
  target_dir: string
  target_path: string | null
  status: ScrapeStatus
  error: string | null
  created_at: number
  updated_at: number
}

let inited = false
function ensureTables(): void {
  if (inited) return
  const db = initDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS scrape_tasks (
      id TEXT PRIMARY KEY,
      download_task_id TEXT,
      file_path TEXT NOT NULL,
      name TEXT NOT NULL,
      singer TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      target_dir TEXT NOT NULL,
      target_path TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scrape_status ON scrape_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_scrape_dl ON scrape_tasks(download_task_id);
  `)
  inited = true
}

const COLUMNS = [
  'id', 'download_task_id', 'file_path', 'name', 'singer', 'album',
  'target_dir', 'target_path', 'status', 'error', 'created_at', 'updated_at',
] as const

export const scrapeStore = {
  insert(row: ScrapeTaskRow): void {
    ensureTables()
    const cols = COLUMNS.map((c) => `@${c}`).join(', ')
    initDb().prepare(`INSERT INTO scrape_tasks (${COLUMNS.join(', ')}) VALUES (${cols})`).run(row)
  },

  update(id: string, patch: Partial<Omit<ScrapeTaskRow, 'id'>>): void {
    ensureTables()
    const keys = Object.keys(patch).filter((k) => k !== 'id')
    if (keys.length === 0) return
    const setClause = keys.map((k) => `${k} = @${k}`).join(', ')
    initDb()
      .prepare(`UPDATE scrape_tasks SET ${setClause}, updated_at = @updated_at WHERE id = @id`)
      .run({ ...patch, id, updated_at: Date.now() })
  },

  get(id: string): ScrapeTaskRow | undefined {
    ensureTables()
    return initDb().prepare('SELECT * FROM scrape_tasks WHERE id = ?').get(id) as ScrapeTaskRow | undefined
  },

  list(opts: { status?: ScrapeStatus; limit?: number } = {}): ScrapeTaskRow[] {
    ensureTables()
    const limit = opts.limit ?? 200
    if (opts.status) {
      return initDb()
        .prepare('SELECT * FROM scrape_tasks WHERE status = ? ORDER BY updated_at DESC LIMIT ?')
        .all(opts.status, limit) as ScrapeTaskRow[]
    }
    return initDb()
      .prepare('SELECT * FROM scrape_tasks ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as ScrapeTaskRow[]
  },

  /** 按 download_task_id 查（用于去重：同一下载任务不重复入队） */
  findByDownloadTask(downloadTaskId: string): ScrapeTaskRow | undefined {
    ensureTables()
    return initDb()
      .prepare('SELECT * FROM scrape_tasks WHERE download_task_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(downloadTaskId) as ScrapeTaskRow | undefined
  },

  createId(): string {
    return randomUUID()
  },
}
