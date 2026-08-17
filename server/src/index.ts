import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyMultipart from '@fastify/multipart'
import path from 'node:path'
import { config, ROOT_DIR } from './core/config.js'
import { logger } from './core/logger.js'
import { statusRoutes } from './routes/status.js'
import { searchRoutes } from './routes/search.js'
import { downloadRoutes } from './routes/download.js'
import { sseRoutes } from './routes/sse.js'
import { sourceRoutes } from './routes/sources.js'
import { playlistRoutes } from './routes/playlists.js'
import { settingsRoutes } from './routes/settings.js'
import { healthRoutes } from './routes/health.js'
import { authRoutes, registerAuthGuard } from './routes/auth.js'
import { createRateLimiter } from './core/rate-limit.js'
import { startSmokeScheduler } from './core/smoke/scheduler.js'
import { sourceEngine } from './core/source-engine/index.js'
import { downloadQueue } from './core/download/queue.js'
import { wireEvents } from './core/events.js'

async function main(): Promise<void> {
  const app = Fastify({ loggerInstance: logger })

  // 音源引擎 + 下载队列启动（引擎先起，队列依赖它取 URL）
  await sourceEngine.start()
  downloadQueue.init()
  wireEvents() // 事件总线接线（供 SSE 广播）

  await app.register(fastifyMultipart, { limits: { fileSize: 5 * 1024 * 1024 } })

  // 应用层限流（放在鉴权之前，先挡住洪水；仅 /api/* 生效）
  if (config.rateLimit.enabled) {
    app.addHook('onRequest', createRateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max }))
    logger.info({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max }, 'rate limit enabled')
  }

  // 鉴权守卫必须在所有业务路由/静态资源之前装到根 app（全局生效）
  registerAuthGuard(app)
  await app.register(authRoutes)

  await app.register(statusRoutes)
  await app.register(searchRoutes)
  await app.register(downloadRoutes)
  await app.register(sseRoutes)
  await app.register(sourceRoutes)
  await app.register(playlistRoutes)
  await app.register(settingsRoutes)
  await app.register(healthRoutes)

  // Web 后台静态资源（web/ 目录），放最后避免抢占 /api 路由
  await app.register(fastifyStatic, {
    root: path.join(ROOT_DIR, 'web'),
    prefix: '/',
  })

  startSmokeScheduler() // 冒烟测试定时器

  await app.listen({ host: config.server.host, port: config.server.port })
  logger.info(`Ro server listening on http://${config.server.host}:${config.server.port}`)
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
