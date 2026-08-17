/**
 * 冒烟测试定时调度 — node-cron，默认每日 06:00。
 * cron 表达式与开关来自 config.smokeTest，设置页改动后需 reschedule。
 */
import cron from 'node-cron'
import { runSmokeTest } from './index.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

let task: cron.ScheduledTask | null = null

export function startSmokeScheduler(): void {
  stopSmokeScheduler()
  if (!config.smokeTest.enabled) {
    logger.info('[smoke] scheduler disabled')
    return
  }
  const expr = config.smokeTest.cron || '0 6 * * *'
  if (!cron.validate(expr)) {
    logger.warn({ expr }, '[smoke] invalid cron expression, scheduler not started')
    return
  }
  task = cron.schedule(expr, () => {
    logger.info('[smoke] cron triggered')
    void runSmokeTest().catch((err) => logger.error({ err: (err as Error).message }, '[smoke] scheduled run failed'))
  })
  logger.info({ expr }, '[smoke] scheduler started')
}

export function stopSmokeScheduler(): void {
  if (task) {
    task.stop()
    task = null
  }
}

/** 设置页改了 cron/开关后调用 */
export function rescheduleSmoke(): void {
  startSmokeScheduler()
}
