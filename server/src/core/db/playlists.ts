/**
 * 歌单持久化层（首版）— 复用 db/index.ts 的同一个 better-sqlite3 连接。
 *
 * 两张表：
 *   playlists       歌单（id/name/desc/时间戳）
 *   playlist_items  歌单内歌曲（含完整 musicInfo JSON，便于直接下载）
 *
 * 首版能力：歌单增删改查 + 歌曲增删；歌曲按 (platform, songmid) 在单个歌单内去重。
 */
import { randomUUID } from 'node:crypto'
import { initDb } from './index.js'
import type { MusicInfo } from '../adapters/common.js'

export interface PlaylistRow {
  id: string
  name: string
  description: string
  created_at: number
  updated_at: number
}

export interface PlaylistItemRow {
  id: string
  playlist_id: string
  platform: string
  songmid: string
  name: string
  singer: string
  album: string
  music_info: string // JSON 序列化 MusicInfo
  created_at: number
}

let inited = false
function ensureTables(): void {
  if (inited) return
  const db = initDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playlist_items (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      songmid TEXT NOT NULL,
      name TEXT NOT NULL,
      singer TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      music_info TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pitems_playlist ON playlist_items(playlist_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pitems_uniq ON playlist_items(playlist_id, platform, songmid);
  `)
  inited = true
}

export const playlistStore = {
  create(name: string, description = ''): PlaylistRow {
    ensureTables()
    const now = Date.now()
    const row: PlaylistRow = { id: randomUUID(), name, description, created_at: now, updated_at: now }
    initDb().prepare(
      'INSERT INTO playlists (id, name, description, created_at, updated_at) VALUES (@id, @name, @description, @created_at, @updated_at)',
    ).run(row)
    return row
  },

  list(): (PlaylistRow & { count: number })[] {
    ensureTables()
    return initDb().prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS count
       FROM playlists p ORDER BY p.updated_at DESC`,
    ).all() as (PlaylistRow & { count: number })[]
  },

  get(id: string): PlaylistRow | undefined {
    ensureTables()
    return initDb().prepare('SELECT * FROM playlists WHERE id = ?').get(id) as PlaylistRow | undefined
  },

  rename(id: string, name: string, description?: string): boolean {
    ensureTables()
    const p = this.get(id)
    if (!p) return false
    initDb().prepare('UPDATE playlists SET name = @name, description = @description, updated_at = @ts WHERE id = @id')
      .run({ id, name, description: description ?? p.description, ts: Date.now() })
    return true
  },

  remove(id: string): boolean {
    ensureTables()
    const db = initDb()
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(id)
    const res = db.prepare('DELETE FROM playlists WHERE id = ?').run(id)
    return res.changes > 0
  },

  items(playlistId: string): PlaylistItemRow[] {
    ensureTables()
    return initDb().prepare('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY created_at ASC').all(playlistId) as PlaylistItemRow[]
  },

  /** 添加歌曲；已存在(同 platform+songmid)则忽略。返回是否新增。 */
  addItem(playlistId: string, platform: string, musicInfo: MusicInfo): boolean {
    ensureTables()
    const db = initDb()
    const row: PlaylistItemRow = {
      id: randomUUID(),
      playlist_id: playlistId,
      platform,
      songmid: String(musicInfo.songmid),
      name: musicInfo.name,
      singer: musicInfo.singer,
      album: musicInfo.albumName ?? '',
      music_info: JSON.stringify(musicInfo),
      created_at: Date.now(),
    }
    const res = db.prepare(
      `INSERT OR IGNORE INTO playlist_items
       (id, playlist_id, platform, songmid, name, singer, album, music_info, created_at)
       VALUES (@id, @playlist_id, @platform, @songmid, @name, @singer, @album, @music_info, @created_at)`,
    ).run(row)
    if (res.changes > 0) db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlistId)
    return res.changes > 0
  },

  removeItem(playlistId: string, itemId: string): boolean {
    ensureTables()
    const res = initDb().prepare('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?').run(itemId, playlistId)
    return res.changes > 0
  },
}
