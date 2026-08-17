/**
 * 鉴权路由 + 全局守卫钩子
 *
 *  POST /api/v1/auth/login   { username, password } → 设 Cookie
 *  POST /api/v1/auth/logout  → 清 Cookie
 *  GET  /api/v1/auth/status  → { enabled, authenticated, passwordConfigured }
 *
 * 全局 onRequest 钩子：
 *   - auth.enabled=false → 全放行
 *   - 白名单路径（登录页/登录接口/静态登录资源）放行
 *   - 其余：校验 session cookie 或 api key，失败则
 *       · /api/* → 401 JSON
 *       · 其它   → 302 跳 /login.html
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
// 注意：守卫钩子必须装在「根 app」上才全局生效（见 index.ts registerAuthGuard），
// 若通过 app.register(authRoutes) 注册，钩子会被 Fastify 封装、只作用于本插件内的路由。
import { config } from '../core/config.js'
import {
  SESSION_COOKIE, verifyLogin, createSession, destroySession,
  validateSession, verifyApiKey, parseCookie, isPasswordConfigured,
} from '../core/auth/index.js'

// 无需鉴权即可访问的路径（登录闭环 + 登录页资源）
const PUBLIC_PATHS = new Set<string>([
  '/login.html',
  '/login.js',
  '/style.css', // 登录页复用主样式表
  '/api/v1/auth/login',
  '/api/v1/auth/status',
  '/favicon.ico',
])

function getToken(req: FastifyRequest): string | undefined {
  return parseCookie(req.headers.cookie, SESSION_COOKIE)
}

function getApiKey(req: FastifyRequest): string | undefined {
  const h = req.headers['x-api-key']
  if (typeof h === 'string' && h) return h
  const auth = req.headers.authorization
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7)
  return undefined
}

function isAuthed(req: FastifyRequest): boolean {
  return validateSession(getToken(req)) || verifyApiKey(getApiKey(req))
}

/**
 * 在根 app 上安装全局鉴权守卫（须在注册业务路由/静态资源前调用）。
 * 参数用 any：主 app 通过 loggerInstance 定制了 logger 泛型，与默认
 * FastifyInstance 泛型不兼容，这里只用到 addHook('onRequest')，放宽即可。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAuthGuard(app: any): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!config.auth.enabled) return
    const url = (req.raw.url ?? '').split('?')[0]!
    if (PUBLIC_PATHS.has(url)) return
    if (isAuthed(req)) return

    if (url.startsWith('/api/')) {
      return reply.code(401).send({ error: '未授权，请先登录或提供有效 API Key' })
    }
    return reply.redirect('/login.html')
  })
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string }
    if (!isPasswordConfigured()) {
      return reply.code(400).send({ error: '尚未设置登录密码，请在 config.yaml 的 auth.webLogin.password 配置后重启' })
    }
    if (!verifyLogin(body.username ?? '', body.password ?? '')) {
      return reply.code(401).send({ error: '用户名或密码错误' })
    }
    const token = createSession()
    const secure = ''
    reply.header('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}${secure}`)
    return { ok: true }
  })

  app.post('/api/v1/auth/logout', async (req, reply) => {
    destroySession(getToken(req))
    reply.header('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`)
    return { ok: true }
  })

  app.get('/api/v1/auth/status', async (req) => {
    return {
      enabled: config.auth.enabled,
      authenticated: !config.auth.enabled || isAuthed(req),
      passwordConfigured: isPasswordConfigured(),
    }
  })
}
