import type { FastifyInstance } from 'fastify'
import { sourceEngine } from '../core/source-engine/index.js'
import { downloadQueue } from '../core/download/queue.js'

const startedAt = Date.now()

export async function statusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/status', async () => {
    const sources = sourceEngine.list()
    const tasks = downloadQueue.list()
    const count = (s: string): number => tasks.filter((t) => t.status === s).length
    return {
      app: 'ro',
      version: '0.1.0',
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      node: process.version,
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      sources: {
        loaded: sources.length,
        ready: sources.filter((s) => s.status === 'ready' && s.enabled).length,
      },
      tasks: {
        pending: count('pending'),
        active: count('active'),
        completed: count('completed') + count('completed_with_warnings'),
        failed: count('failed'),
      },
    }
  })
}
