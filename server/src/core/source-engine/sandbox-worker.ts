/**
 * 音源脚本沙箱 Worker — 在独立 worker_threads 中运行音源脚本
 *
 * 隔离策略（无 g++ 环境，弃用 isolated-vm，采用 worker + vm 双层）：
 *  1. worker_threads 独立线程：脚本崩溃/死循环不拖垮主服务，可整体 terminate
 *  2. node:vm 上下文：脚本只能拿到我们注入的 lx 全局对象和白名单全局量，
 *     不暴露 require/process/module（vm 逃逸风险仍存在，但攻击面已缩到
 *     「恶意脚本」级别，且与上游桌面版的隐藏 BrowserWindow 方案安全水位相当）
 *
 * 与主线程通信协议（postMessage）：
 *  worker → main: { type: 'inited', sources } | { type: 'update-alert', data }
 *                | { type: 'error', message } | { type: 'action-result', id, ok, result?, message? }
 *  main → worker: { type: 'call-action', id, source, action, info }
 */
import { parentPort, workerData } from 'node:worker_threads'
import vm from 'node:vm'
import { LxEnv, type ScriptInfo, type SourceAction } from './lx-env.js'

const { scriptInfo } = workerData as { scriptInfo: ScriptInfo }

if (!parentPort) throw new Error('must run as worker thread')
const port = parentPort

const env = new LxEnv(scriptInfo, {
  onInited(sources) {
    port.postMessage({ type: 'inited', sources })
  },
  onUpdateAlert(data) {
    port.postMessage({ type: 'update-alert', data })
  },
  onError(message) {
    port.postMessage({ type: 'error', message })
  },
})

port.on('message', (msg: { type: string; id: number; source: string; action: SourceAction; info: unknown }) => {
  if (msg.type !== 'call-action') return
  env
    .callAction(msg.source, msg.action, msg.info)
    .then((result) => port.postMessage({ type: 'action-result', id: msg.id, ok: true, result }))
    .catch((err: Error) => port.postMessage({ type: 'action-result', id: msg.id, ok: false, message: err.message }))
})

// ---- 在 vm 上下文中执行音源脚本 ----
// 完整 console 代理：混淆脚本可能调用任意 console 方法（info/debug/group/…），
// 缺失方法会触发 "Bind must be called on a function" 之类的怪错
function makeConsole(): Record<string, (...args: unknown[]) => void> {
  const proxy: Record<string, (...args: unknown[]) => void> = {}
  for (const k of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'group', 'groupCollapsed', 'groupEnd', 'table', 'time', 'timeEnd', 'timeLog', 'count', 'countReset', 'assert']) {
    proxy[k] = function (...args: unknown[]) {
      port.postMessage({ type: 'log', level: k === 'error' ? 'error' : k === 'warn' ? 'warn' : 'info', args: args.map(String) })
    }
  }
  return proxy
}

const sandbox: Record<string, unknown> = {
  lx: env.buildGlobal(),
  console: makeConsole(),
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  // 不暴露 require / process / module / __dirname —— 脚本只能用 lx.* 能力
}
sandbox.globalThis = sandbox
sandbox.window = sandbox

try {
  vm.createContext(sandbox, { name: `lx-source:${scriptInfo.name}` })
  vm.runInContext(scriptInfo.rawScript, sandbox as vm.Context, {
    filename: `${scriptInfo.name}.js`,
    timeout: 30_000, // 同步执行上限，防死循环占住线程
  })
} catch (err) {
  port.postMessage({ type: 'error', message: (err as Error).message })
}
