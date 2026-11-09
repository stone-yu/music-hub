import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function setup(value: string) {
  const elements = new Map<string, any>()
  const $ = (id: string) => {
    if (!elements.has(id)) elements.set(id, { value, hidden: false, disabled: false, addEventListener(type: string, fn: any) { this[type] = fn }, click() { if (!this.disabled) return this.clickHandler() } })
    return elements.get(id)
  }
  const calls: string[] = [], opened: any[] = []
  const context = vm.createContext({ $, plActivePlatform: 'kw', encodeURIComponent, toast() {}, escapeHtml: (s: string) => s,
    PLATFORM_NAME: {}, renderPlaylistGrid() {},
    fetchJSON: async (url: string) => { calls.push(url); return { platform: 'wy', id: '123', detail: { info: { name: '分享歌单' } }, results: [] } },
    openPlaylistDetail: async (...args: any[]) => opened.push(args),
  })
  const source = readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8')
  vm.runInContext(source.slice(source.indexOf("$('#pl-search-btn').addEventListener"), source.indexOf("$('#pl-refresh-btn').addEventListener")), context)
  // addEventListener stores the click listener in the mock's click property.
  return { $, calls, opened, submit: () => $('#pl-search-btn').click() }
}
test('shared link resolves independently of the selected platform and reuses detail', async () => {
  const h = setup('分享 https://music.163.com/playlist?id=123')
  await h.submit()
  assert.equal(h.calls.length, 1)
  assert.match(h.calls[0]!, /^\/api\/v1\/square\/resolve\?url=/)
  assert.equal(h.opened[0][0], 'wy')
  assert.equal(h.opened[0][3].id, '123')
  assert.equal(h.$('#pl-search-btn').disabled, false)
})
test('keywords retain the platform filter', async () => {
  const h = setup('民谣')
  await h.submit()
  assert.match(h.calls[0]!, /^\/api\/v1\/square\/search\?keyword=.*&platforms=kw$/)
  assert.equal(h.opened.length, 0)
})
