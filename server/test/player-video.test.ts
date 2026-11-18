import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8')
const playerSource = source.split('// ---------- 全局播放器 + 播放队列 ----------')[1].split('// ---------- 创建歌单悬浮球')[0]
function player(fetchJSON = async (..._args: any[]): Promise<any> => ({})) {
  const nodes = new Map<string, any>()
  function element() {
    const classes = new Set<string>()
    const handlers: Record<string, Function> = {}
    return {
      hidden: true, dataset: {}, style: {}, innerHTML: '', textContent: '', src: '', paused: true, videoWidth: 0,
      classList: { add: (x: string) => classes.add(x), remove: (...xs: string[]) => xs.forEach(x => classes.delete(x)), contains: (x: string) => classes.has(x), toggle: (x: string, on: boolean) => on ? classes.add(x) : classes.delete(x) },
      addEventListener: (event: string, cb: Function) => { handlers[event] = cb },
      emit(event: string) { handlers[event]?.() },
      querySelectorAll: () => [], querySelector: () => null,
      getAttribute(name: string) { return name === 'src' ? this.src : null },
      removeAttribute(name: string) { if (name === 'src') this.src = '' },
      play() { this.paused = false; return Promise.resolve() }, pause() { this.paused = true }, load() {},
    }
  }
  const $ = (id: string) => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id) }
  const context = vm.createContext({ $, fetchJSON, document: { querySelector: (s: string) => s === '#global-audio' ? $(s) : null, querySelectorAll: () => [], body: $('body') }, window: { innerWidth: 1200 }, toast() {}, coverHtml: () => '', escapeHtml: (s: string) => s, confirm: () => true })
  vm.runInContext(playerSource, context)
  return { $, run: (s: string) => vm.runInContext(s, context) }
}

test('video metadata reveals persistent media and opens right panel', () => {
  const { $, run } = player()
  run('startQueue([{kind:"nav", id:"video", label:"Video"}])')
  const media = $('#global-audio')
  assert.equal(media.hidden, true)
  media.videoWidth = 1920
  media.emit('loadedmetadata')
  assert.equal(media.hidden, false)
  assert.equal($('#queue-panel').classList.contains('show'), true)
  assert.equal($('#queue-panel').classList.contains('has-video'), true)
  run('hideQueuePanel(); showQueuePanel(); renderQueuePanel()')
  assert.equal($('#global-audio'), media)
  assert.equal(media.paused, false)
  assert.equal(media.src, '/api/v1/navidrome/stream/video')
})

test('switch to audio hides video and stop clears media state', () => {
  const { $, run } = player()
  run('startQueue([{kind:"nav", id:"video", label:"Video"}, {kind:"nav", id:"audio", label:"Audio"}])')
  const media = $('#global-audio')
  media.videoWidth = 640
  media.emit('loadedmetadata')
  run('playNext()')
  assert.equal(media.hidden, true)
  media.videoWidth = 0
  media.emit('loadedmetadata')
  assert.equal(media.hidden, true)
  assert.equal($('#queue-panel').classList.contains('has-video'), false)
  run('stopPlayer()')
  assert.equal(media.src, '')
  assert.equal(media.paused, true)
  assert.equal(media.dataset.rid, '')
})

test('shared controls and ended advance video in the same queue', () => {
  const { $, run } = player()
  run('startQueue([{kind:"nav", id:"one", label:"One"}, {kind:"nav", id:"two", label:"Two"}])')
  const media = $('#global-audio')
  run('togglePlay()')
  assert.equal(media.paused, true)
  run('togglePlay()')
  assert.equal(media.paused, false)
  media.emit('ended')
  assert.equal(media.src, '/api/v1/navidrome/stream/two')
})

test('late preview response cannot replace a newly selected video', async () => {
  let resolve!: (value: any) => void
  const pending = new Promise(r => { resolve = r })
  const { $, run } = player(() => pending)
  run('startQueue([{kind:"net",platform:"wy",musicInfo:{songmid:"old"},label:"Old"},{kind:"nav",id:"video",label:"Video"}]); playNext()')
  resolve({ url: 'https://example.test/old.mp3' })
  await new Promise(r => setImmediate(r))
  assert.equal($('#global-audio').src, '/api/v1/navidrome/stream/video')
})

test('late preview response cannot restart a stopped player', async () => {
  let resolve!: (value: any) => void
  const pending = new Promise(r => { resolve = r })
  const { $, run } = player(() => pending)
  run('startQueue([{kind:"net",platform:"wy",musicInfo:{songmid:"old"},label:"Old"}]); stopPlayer()')
  resolve({ url: 'https://example.test/old.mp3' })
  await new Promise(r => setImmediate(r))
  assert.equal($('#global-audio').src, '')
  assert.equal($('#global-audio').paused, true)
})

test('markup keeps video outside dynamically rendered queue content', () => {
  const html = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8')
  assert.equal((html.match(/id="global-audio"/g) || []).length, 1)
  assert.match(html, /<video[^>]+id="global-audio"[^>]+playsinline/)
  assert.match(html, /<\/video>\s*<div id="queue-content"/)
})

test('video and audio cover share the same reserved aspect ratio', () => {
  const css = readFileSync(new URL('../../web/style.css', import.meta.url), 'utf8')
  assert.match(css, /\.queue-video,\s*\.queue-now-cover-wrap\s*\{\s*aspect-ratio:\s*1\s*\/\s*1;/)
  const videoRule = css.match(/\.queue-video\s*\{([^}]+)\}/)?.[1] || ''
  assert.doesNotMatch(videoRule, /max-height|aspect-ratio/)
  assert.match(videoRule, /object-fit:\s*contain/)
})
