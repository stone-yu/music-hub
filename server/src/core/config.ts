import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// server/src/core → 项目根目录 ro/
export const ROOT_DIR = path.resolve(__dirname, '../../..')

export interface RoConfig {
  server: { host: string; port: number }
  auth: {
    enabled: boolean
    apiKey: string
    webLogin: { username: string; password: string }
  }
  download: {
    dir: string
    concurrency: number
    defaultQuality: 'flac24bit' | 'flac' | '320k' | '128k'
    nameTemplate: string
    embedCover: boolean
    embedLyric: boolean
    coverSize: number
  }
  sources: { dir: string; hotReload: boolean }
  navidrome: { url: string; user: string; password: string; musicDir: string }
  scrape: { enabled: boolean; autoOnDownload: boolean; targetDir: string }
  rateLimit: { enabled: boolean; windowMs: number; max: number }
  smokeTest: {
    enabled: boolean
    cron: string
    keyword: string
    checkLyric: boolean
    checkPic: boolean
    alertThreshold: number
    alert: {
      bark: { enabled: boolean; serverUrl: string; deviceKey: string }
      serverChan: { enabled: boolean; sendKey: string }
    }
  }
  log: { level: string }
}

const CONFIG_PATH = process.env.CONFIG_PATH ?? process.env.RO_CONFIG ?? path.join(ROOT_DIR, 'config/config.yaml')

function applyEnvOverrides(cfg: RoConfig): void {
  // 兼容旧版 MusicHub 变量名（无 RO_ 前缀）+ ro 新版变量名
  if (process.env.PORT || process.env.RO_SERVER_PORT) cfg.server.port = Number(process.env.PORT || process.env.RO_SERVER_PORT)
  if (process.env.HOST || process.env.RO_SERVER_HOST) cfg.server.host = process.env.HOST || process.env.RO_SERVER_HOST || ''
  if (process.env.RO_AUTH_APIKEY) cfg.auth.apiKey = process.env.RO_AUTH_APIKEY
  if (process.env.RO_LOG_LEVEL) cfg.log.level = process.env.RO_LOG_LEVEL
  if (process.env.LOGIN_PASSWORD) cfg.auth.webLogin.password = process.env.LOGIN_PASSWORD || ''
  // Navidrome 凭据（兼容旧版 NAVIDROME_URL/USER/PASS + 新版 RO_NAVIDROME_*）
  if (process.env.NAVIDROME_URL || process.env.RO_NAVIDROME_URL) cfg.navidrome.url = process.env.NAVIDROME_URL || process.env.RO_NAVIDROME_URL || ''
  if (process.env.NAVIDROME_USER || process.env.RO_NAVIDROME_USER) cfg.navidrome.user = process.env.NAVIDROME_USER || process.env.RO_NAVIDROME_USER || ''
  if (process.env.NAVIDROME_PASS || process.env.NAVIDROME_PASSWORD || process.env.RO_NAVIDROME_PASSWORD) cfg.navidrome.password = process.env.NAVIDROME_PASS || process.env.NAVIDROME_PASSWORD || process.env.RO_NAVIDROME_PASSWORD || ''
}

export function loadConfig(): RoConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
  const cfg = YAML.parse(raw) as RoConfig
  applyEnvOverrides(cfg)
  // 相对路径统一相对项目根目录解析
  cfg.download.dir = path.resolve(ROOT_DIR, cfg.download.dir)
  cfg.sources.dir = path.resolve(ROOT_DIR, cfg.sources.dir)
  cfg.navidrome.musicDir = path.resolve(ROOT_DIR, cfg.navidrome.musicDir)
  cfg.scrape.targetDir = path.resolve(ROOT_DIR, cfg.scrape.targetDir)
  return cfg
}

export function saveConfig(cfg: RoConfig): void {
  // 写回时把绝对路径还原为相对（避免把机器绝对路径固化进 yaml）
  const out = JSON.parse(JSON.stringify(cfg)) as RoConfig
  out.download.dir = path.relative(ROOT_DIR, cfg.download.dir) || cfg.download.dir
  out.sources.dir = path.relative(ROOT_DIR, cfg.sources.dir) || cfg.sources.dir
  out.navidrome.musicDir = path.relative(ROOT_DIR, cfg.navidrome.musicDir) || cfg.navidrome.musicDir
  out.scrape.targetDir = path.relative(ROOT_DIR, cfg.scrape.targetDir) || cfg.scrape.targetDir
  fs.writeFileSync(CONFIG_PATH, YAML.stringify(out), 'utf8')
}

export const config = loadConfig()

/**
 * 运行时局部更新配置（设置页用）。深合并 patch → 保存到 yaml → 原地更新 config 对象。
 * 注意：server/auth 等需重启才生效的字段，这里只落盘，运行态不强制刷新。
 */
export function patchConfig(patch: DeepPartial<RoConfig>): RoConfig {
  deepMerge(config as unknown as Record<string, unknown>, patch as Record<string, unknown>)
  // 路径字段重新解析为绝对路径
  config.download.dir = path.resolve(ROOT_DIR, config.download.dir)
  config.sources.dir = path.resolve(ROOT_DIR, config.sources.dir)
  config.navidrome.musicDir = path.resolve(ROOT_DIR, config.navidrome.musicDir)
  config.scrape.targetDir = path.resolve(ROOT_DIR, config.scrape.targetDir)
  saveConfig(config)
  return config
}

type DeepPartial<T> = { [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P] }

function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof target[k] === 'object' && target[k] !== null) {
      deepMerge(target[k] as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      target[k] = v
    }
  }
}
