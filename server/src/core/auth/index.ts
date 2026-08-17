/**
 * 鉴权 — 个人自用 / 局域网部署的轻量方案
 *
 * 两种通行方式：
 *   1. Web 登录：用户名+密码 → 签发内存 session token，写 HttpOnly Cookie（ro_sess）
 *   2. API Key：请求头 x-api-key 或 Authorization: Bearer <key> —— 给脚本/自动化用
 *
 * 关闭鉴权（config.auth.enabled=false）时全部放行。
 * 局域网自用，不追求高强度：session 存内存，重启即失效（重新登录即可）。
 */
import crypto from 'node:crypto'
import { config } from '../config.js'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 天
export const SESSION_COOKIE = 'ro_sess'

interface Session {
  token: string
  createdAt: number
  expiresAt: number
}

const sessions = new Map<string, Session>()

function sweep(): void {
  const now = Date.now()
  for (const [t, s] of sessions) if (s.expiresAt <= now) sessions.delete(t)
}

/** 校验 Web 登录凭据（时间安全比较） */
export function verifyLogin(username: string, password: string): boolean {
  const u = config.auth.webLogin.username
  const p = config.auth.webLogin.password
  if (!u || !p) return false // 未设置密码时禁止登录（引导用户先配密码）
  return safeEqual(username, u) && safeEqual(password, p)
}

/** 签发新 session，返回 token */
export function createSession(): string {
  sweep()
  const token = crypto.randomBytes(32).toString('hex')
  const now = Date.now()
  sessions.set(token, { token, createdAt: now, expiresAt: now + SESSION_TTL_MS })
  return token
}

/** 校验 session token 是否有效 */
export function validateSession(token: string | undefined): boolean {
  if (!token) return false
  const s = sessions.get(token)
  if (!s) return false
  if (s.expiresAt <= Date.now()) { sessions.delete(token); return false }
  return true
}

/** 销毁 session（登出） */
export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token)
}

/** 校验 API Key */
export function verifyApiKey(key: string | undefined): boolean {
  const k = config.auth.apiKey
  if (!k || !key) return false
  return safeEqual(key, k)
}

/** 是否已配置密码（前端登录页据此提示） */
export function isPasswordConfigured(): boolean {
  return Boolean(config.auth.webLogin.password)
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/** 解析 Cookie 头，取指定 name */
export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim())
  }
  return undefined
}
