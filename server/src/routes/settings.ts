/**
 * 设置路由
 *   GET  /api/v1/settings              返回可编辑配置（脱敏）
 *   PATCH /api/v1/settings             局部更新配置（下载/告警/冒烟）
 *   POST /api/v1/settings/notify/test  测试告警推送
 *
 * 安全：apiKey / webLogin.password 不回传明文，只回传是否已设置。
 */
import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { config, patchConfig } from '../core/config.js'
import { notify } from '../core/notify/index.js'
import { downloadQueue } from '../core/download/queue.js'
import { rescheduleSmoke } from '../core/smoke/scheduler.js'

const QUALITIES = ['flac24bit', 'flac', '320k', '128k']

/** 脱敏后的配置视图（不含密钥明文） */
function safeView() {
  return {
    auth: {
      // 只回传是否已设置 API Key，绝不回传明文（明文仅在生成的那一次响应里出现）
      apiKeySet: !!config.auth.apiKey,
    },
    download: {
      concurrency: config.download.concurrency,
      defaultQuality: config.download.defaultQuality,
      nameTemplate: config.download.nameTemplate,
      embedCover: config.download.embedCover,
      embedLyric: config.download.embedLyric,
      coverSize: config.download.coverSize,
    },
    smokeTest: {
      enabled: config.smokeTest.enabled,
      cron: config.smokeTest.cron,
      keyword: config.smokeTest.keyword,
      checkLyric: config.smokeTest.checkLyric,
      checkPic: config.smokeTest.checkPic,
      alertThreshold: config.smokeTest.alertThreshold,
      alert: {
        bark: {
          enabled: config.smokeTest.alert.bark.enabled,
          serverUrl: config.smokeTest.alert.bark.serverUrl,
          deviceKeySet: !!config.smokeTest.alert.bark.deviceKey,
        },
        serverChan: {
          enabled: config.smokeTest.alert.serverChan.enabled,
          sendKeySet: !!config.smokeTest.alert.serverChan.sendKey,
        },
      },
    },
  }
}

interface SettingsPatch {
  download?: Partial<{
    concurrency: number
    defaultQuality: string
    nameTemplate: string
    embedCover: boolean
    embedLyric: boolean
    coverSize: number
  }>
  smokeTest?: {
    enabled?: boolean
    cron?: string
    keyword?: string
    checkLyric?: boolean
    checkPic?: boolean
    alertThreshold?: number
    alert?: {
      bark?: { enabled?: boolean; serverUrl?: string; deviceKey?: string }
      serverChan?: { enabled?: boolean; sendKey?: string }
    }
  }
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/settings', async () => safeView())

  app.patch<{ Body: SettingsPatch }>('/api/v1/settings', async (req, reply) => {
    const body = req.body ?? {}
    // 校验若干关键字段
    if (body.download?.concurrency != null) {
      const c = Number(body.download.concurrency)
      if (!Number.isInteger(c) || c < 1 || c > 10) return reply.code(400).send({ error: 'concurrency 需为 1-10 的整数' })
    }
    if (body.download?.defaultQuality != null && !QUALITIES.includes(body.download.defaultQuality)) {
      return reply.code(400).send({ error: 'invalid defaultQuality', valid: QUALITIES })
    }
    if (body.download?.coverSize != null) {
      const s = Number(body.download.coverSize)
      if (!Number.isInteger(s) || s < 100 || s > 1000) return reply.code(400).send({ error: 'coverSize 需为 100-1000 的整数' })
    }
    // 空字符串的密钥字段视为「不修改」，避免脱敏视图回传后被清空
    if (body.smokeTest?.alert?.bark && body.smokeTest.alert.bark.deviceKey === '') delete body.smokeTest.alert.bark.deviceKey
    if (body.smokeTest?.alert?.serverChan && body.smokeTest.alert.serverChan.sendKey === '') delete body.smokeTest.alert.serverChan.sendKey

    patchConfig(body as Parameters<typeof patchConfig>[0])
    // 并发变化即时生效
    if (body.download?.concurrency != null) downloadQueue.setConcurrency(config.download.concurrency)
    if (body.smokeTest?.cron != null || body.smokeTest?.enabled != null) rescheduleSmoke()
    return safeView()
  })

  // 随机生成一个新的 API Key：存盘并「仅此一次」在响应里返回明文。
  // 之后任何 GET /settings 都只能看到 apiKeySet=true，拿不到明文。
  app.post('/api/v1/settings/apikey/generate', async () => {
    // 32 字节 → 43 位 base64url，足够强；前缀 ro_ 方便识别
    const key = 'ro_' + crypto.randomBytes(32).toString('base64url')
    patchConfig({ auth: { apiKey: key } })
    // 明文只在这里出现一次；提醒前端立即展示并让用户保存
    return { apiKey: key, once: true }
  })

  // 撤销 / 清除当前 API Key
  app.delete('/api/v1/settings/apikey', async () => {
    patchConfig({ auth: { apiKey: '' } })
    return { ok: true, apiKeySet: false }
  })

  app.post<{ Body: { title?: string; body?: string } }>('/api/v1/settings/notify/test', async (req) => {
    const title = req.body?.title || 'Ro 测试通知'
    const body = req.body?.body || `这是一条来自 Ro 的测试推送 (${new Date().toLocaleString('zh-CN')})`
    const results = await notify(title, body)
    return { results }
  })
}
