/**
 * 应用层限流 — 固定窗口计数器（内存版，个人自用足够）
 *
 * 仅对 /api/* 生效（静态资源不限），按客户端 IP 分桶。
 * 局域网自用，不追求分布式；重启清零。
 */
import type { FastifyReply, FastifyRequest } from 'fastify'

interface Bucket {
  count: number
  resetAt: number
}

export interface RateLimitOptions {
  windowMs: number
  max: number
}

export function createRateLimiter(opts: RateLimitOptions) {
  const buckets = new Map<string, Bucket>()

  // 周期性清理过期桶，防内存无限增长
  const sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [ip, b] of buckets) if (b.resetAt <= now) buckets.delete(ip)
  }, opts.windowMs)
  sweepTimer.unref?.()

  return async function rateLimiter(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const url = (req.raw.url ?? '').split('?')[0]!
    if (!url.startsWith('/api/')) return // 只限 API

    const ip = req.ip || 'unknown'
    const now = Date.now()
    let b = buckets.get(ip)
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs }
      buckets.set(ip, b)
    }
    b.count++

    const remaining = Math.max(0, opts.max - b.count)
    reply.header('X-RateLimit-Limit', String(opts.max))
    reply.header('X-RateLimit-Remaining', String(remaining))
    reply.header('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)))

    if (b.count > opts.max) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000)
      reply.header('Retry-After', String(retryAfter))
      return reply.code(429).send({ error: `请求过于频繁，请 ${retryAfter}s 后再试` })
    }
  }
}
