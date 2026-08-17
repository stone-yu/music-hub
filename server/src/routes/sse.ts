/**
 * SSE 实时推送
 *   GET /api/v1/sse/subscribe
 *
 * 事件流（event: <name>\ndata: <json>\n\n）：
 *   task:created / task:active / task:progress / task:completed /
 *   task:completed_with_warnings / task:failed / task:canceled /
 *   source:changed / source:update-alert / smoke:completed / smoke:failed
 *
 * 客户端断线重连后应调用 GET /api/v1/tasks 做一次全量对账。
 */
import type { FastifyInstance } from 'fastify'
import { eventBus, type RoEvent } from '../core/events.js'
import { logger } from '../core/logger.js'

export async function sseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/sse/subscribe', async (req, reply) => {
    // 接管原始响应，阻止 Fastify 再自行发送响应
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    // 首包：告知已连接 + 建议全量对账
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`)

    const onEvent = (evt: RoEvent): void => {
      try {
        reply.raw.write(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`)
      } catch (err) {
        logger.warn({ err: (err as Error).message }, '[sse] write failed')
      }
    }
    eventBus.on('event', onEvent)

    // 心跳（注释行），防止中间层因空闲断连
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: ping ${Date.now()}\n\n`)
      } catch {
        /* ignore */
      }
    }, 15_000)

    const cleanup = (): void => {
      clearInterval(heartbeat)
      eventBus.off('event', onEvent)
    }
    req.raw.on('close', cleanup)
    req.raw.on('error', cleanup)

    // hijack 后不再 return reply，连接由 raw 写入保持
  })
}
