/**
 * 全局事件总线 — 把下载队列、音源引擎、冒烟测试的事件汇聚到一处，
 * 供 SSE 路由统一订阅广播。各生产者仍各自 emit，这里只做转发聚合。
 */
import { EventEmitter } from 'node:events'
import { downloadQueue } from './download/queue.js'
import { sourceEngine } from './source-engine/index.js'

export interface RoEvent {
  event: string
  data: unknown
}

class EventBus extends EventEmitter {}
export const eventBus = new EventBus()
// SSE 连接可能较多，放宽上限
eventBus.setMaxListeners(100)

function forward(source: EventEmitter, names: string[]): void {
  for (const name of names) {
    source.on(name, (data: unknown) => {
      eventBus.emit('event', { event: name, data } satisfies RoEvent)
    })
  }
}

let wired = false
/** 在服务启动时调用一次，接线各生产者 */
export function wireEvents(): void {
  if (wired) return
  wired = true
  forward(downloadQueue, [
    'task:created',
    'task:active',
    'task:progress',
    'task:pending',
    'task:completed',
    'task:completed_with_warnings',
    'task:failed',
    'task:canceled',
  ])
  forward(sourceEngine, ['source:changed', 'source:update-alert'])
}

/** 冒烟测试等其他模块可直接往总线发事件（阶段 6 用） */
export function emitEvent(event: string, data: unknown): void {
  eventBus.emit('event', { event, data } satisfies RoEvent)
}
