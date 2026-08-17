/**
 * SQLite 任务持久化层（better-sqlite3，同步 API）
 * 存下载任务，进程重启后可续跑/对账。
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { ROOT_DIR } from '../config.js'
import { logger } from '../logger.js'

export type TaskStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'
  | 'canceled'

export interface DownloadTaskRow {
  id: string
  keyword_source: string // 触发来源平台（歌曲原始平台）
  platform: string
  songmid: string
  name: string
  singer: string
  album: string
  requested_quality: string
  actual_quality: string | null
  actual_source: string | null // 实际命中的音源脚本 id
  music_info: string // JSON 序列化的 MusicInfo
  status: TaskStatus
  progress: number // 0-100
  file_path: string | null
  file_size: number | null
  warnings: string | null // JSON 数组
  error: string | null
  created_at: number
  updated_at: number
}

let db: Database.Database

export function initDb(): Database.Database {
  if (db) return db
  // 默认 <root>/data；可用 RO_DB_DIR 覆盖（Docker 里指向单独映射的 /app/data/db，
  // 避免 WAL 模式的 ro.db-wal/-shm 与单文件 bind mount 冲突）
  const dataDir = process.env.RO_DB_DIR
    ? path.resolve(process.env.RO_DB_DIR)
    : path.join(ROOT_DIR, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const dbPath = path.join(dataDir, 'ro.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS download_tasks (
      id TEXT PRIMARY KEY,
      keyword_source TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL,
      songmid TEXT NOT NULL,
      name TEXT NOT NULL,
      singer TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      requested_quality TEXT NOT NULL,
      actual_quality TEXT,
      actual_source TEXT,
      music_info TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      file_path TEXT,
      file_size INTEGER,
      warnings TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON download_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_created ON download_tasks(created_at);
  `)
  logger.info(`SQLite ready at ${dbPath}`)
  return db
}

function getDb(): Database.Database {
  return db ?? initDb()
}

const COLUMNS = [
  'id', 'keyword_source', 'platform', 'songmid', 'name', 'singer', 'album',
  'requested_quality', 'actual_quality', 'actual_source', 'music_info',
  'status', 'progress', 'file_path', 'file_size', 'warnings', 'error',
  'created_at', 'updated_at',
] as const

export const taskStore = {
  insert(row: DownloadTaskRow): void {
    const placeholders = COLUMNS.map((c) => `@${c}`).join(', ')
    getDb().prepare(`INSERT INTO download_tasks (${COLUMNS.join(', ')}) VALUES (${placeholders})`).run(row)
  },

  update(id: string, patch: Partial<DownloadTaskRow>): void {
    const keys = Object.keys(patch).filter((k) => k !== 'id')
    if (keys.length === 0) return
    const setClause = keys.map((k) => `${k} = @${k}`).join(', ')
    getDb()
      .prepare(`UPDATE download_tasks SET ${setClause}, updated_at = @updated_at WHERE id = @id`)
      .run({ ...patch, id, updated_at: Date.now() })
  },

  get(id: string): DownloadTaskRow | undefined {
    return getDb().prepare('SELECT * FROM download_tasks WHERE id = ?').get(id) as DownloadTaskRow | undefined
  },

  list(opts: { status?: TaskStatus; limit?: number; offset?: number } = {}): DownloadTaskRow[] {
    const where = opts.status ? 'WHERE status = @status' : ''
    const limit = opts.limit ?? 100
    const offset = opts.offset ?? 0
    return getDb()
      .prepare(`SELECT * FROM download_tasks ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
      .all({ status: opts.status, limit, offset }) as DownloadTaskRow[]
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM download_tasks WHERE id = ?').run(id)
  },

  /** 启动时把中断的 active 任务标记回 pending（重启续跑） */
  requeueInterrupted(): number {
    const res = getDb()
      .prepare(`UPDATE download_tasks SET status = 'pending', progress = 0, updated_at = ? WHERE status = 'active'`)
      .run(Date.now())
    return res.changes
  },
}
