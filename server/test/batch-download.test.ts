import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const app = readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8')
function batchCode() {
  const source = app.split('// ---------- 批量下载：选择与提交 ----------')[1]?.split('// ---------- 批量下载：界面 ----------')[0]
  assert.ok(source, 'batch download helpers must exist')
  return source
}
function helpers() {
  const context = vm.createContext({ rowKey: (item: any) => `${item.platform}:${item.songmid}` })
  vm.runInContext(batchCode(), context)
  return vm.runInContext('({ createBatchDownloadSelection, submitBatchDownloads })', context)
}
const songs = (count: number) => Array.from({ length: count }, (_, i) => ({ platform: 'wy', songmid: String(i + 1), name: `Song ${i + 1}` }))

test('selection skips matched songs, deduplicates and preserves separate list state', () => {
  const { createBatchDownloadSelection } = helpers()
  const list = songs(3)
  const first = createBatchDownloadSelection([...list, list[0]])
  const second = createBatchDownloadSelection(list)
  first.setMatched(['wy:2'])
  first.selectAll()
  assert.deepEqual(Array.from(first.selectedItems(), (it: any) => it.songmid), ['1', '3'])
  assert.equal(second.selectedItems().length, 0)
  first.toggle('wy:2', true)
  assert.equal(first.selectedItems().length, 2)
  first.setMatched(['wy:1', 'wy:2'])
  assert.deepEqual(Array.from(first.selectedItems(), (it: any) => it.songmid), ['3'])
  first.clear()
  assert.equal(first.selectedItems().length, 0)
})

test('submission chunks at 200 and uses one quality for every song', async () => {
  const { submitBatchDownloads } = helpers()
  const calls: any[] = []
  const acknowledged: any[] = []
  const result = await submitBatchDownloads(songs(405), 'flac', async (body: any) => {
    calls.push(body)
    return { accepted: body.items.map((_it: any, index: number) => ({ index, id: `task-${calls.length}-${index}` })), rejected: [] }
  }, (items: any[]) => acknowledged.push(...items))
  assert.deepEqual(calls.map(c => c.items.length), [200, 200, 5])
  assert.ok(calls.every(c => c.quality === 'flac' && c.items.every((it: any) => it.platform === 'wy' && it.musicInfo.songmid)))
  assert.equal(result.accepted.length, 405)
  assert.equal(acknowledged.length, 405)
  assert.equal(result.rejected.length, 0)
})

test('partial rejection removes only acknowledged successes from selection', async () => {
  const { createBatchDownloadSelection, submitBatchDownloads } = helpers()
  const selection = createBatchDownloadSelection(songs(3))
  selection.selectAll()
  const result = await submitBatchDownloads(selection.selectedItems(), '320k', async () => ({ accepted: [{ index: 0, id: 'a' }, { index: 2, id: 'b' }], rejected: [{ index: 1, error: 'invalid quality' }] }), (items: any[]) => items.forEach(it => selection.toggle(`wy:${it.songmid}`, false)))
  assert.equal(result.accepted.length, 2)
  assert.equal(result.rejected.length, 1)
  assert.deepEqual(Array.from(selection.selectedItems(), (it: any) => it.songmid), ['2'])
})

test('failed chunk stops submission without automatic retry or losing later selections', async () => {
  const { submitBatchDownloads } = helpers()
  let calls = 0
  const result = await submitBatchDownloads(songs(405), '128k', async (body: any) => {
    calls++
    if (calls === 2) throw Error('offline')
    return { accepted: body.items.map((_it: any, index: number) => ({ index, id: String(index) })), rejected: [] }
  })
  assert.equal(calls, 2)
  assert.equal(result.accepted.length, 200)
  assert.equal(result.uncertain.length, 200)
  assert.equal(result.unsubmitted.length, 5)
  assert.match(result.error, /offline/)
})

function downloadUI(pickQuality: () => Promise<string | null>) {
  const views = new WeakMap()
  const calls: any[] = []
  const context = vm.createContext({
    rowKey: (item: any) => `${item.platform}:${item.songmid}`,
    batchDownloadViews: views, pickQuality,
    updateBatchDownloadView() {}, globalTasksTick() {}, toast() {},
    fetchJSON: async (_url: string, options: any) => {
      const body = JSON.parse(options.body)
      calls.push(body)
      return { accepted: body.items.map((_it: any, index: number) => ({ index, id: `task-${index}` })), rejected: [] }
    },
  })
  vm.runInContext(batchCode(), context)
  const handler = 'async function downloadBatchSelection(container)' + app.split('async function downloadBatchSelection(container)')[1].split('function updateBatchDownloadMatches')[0]
  vm.runInContext(handler, context)
  const selection = vm.runInContext('createBatchDownloadSelection', context)(songs(3))
  selection.selectAll()
  const container = { isConnected: true }
  const view = { selection, ready: true, busy: false, result: '' }
  views.set(container, view)
  return { calls, view, views, container, download: () => vm.runInContext('downloadBatchSelection', context)(container) }
}

test('cancelling quality selection submits nothing and preserves selected songs', async () => {
  const ui = downloadUI(async () => null)
  await ui.download()
  assert.equal(ui.calls.length, 0)
  assert.equal(ui.view.selection.selectedItems().length, 3)
  assert.equal(ui.view.busy, false)
})

test('repeated submit clicks cannot create duplicate batches while choosing quality', async () => {
  let choose!: (quality: string) => void
  const pending = new Promise<string>(resolve => { choose = resolve })
  const ui = downloadUI(() => pending)
  const first = ui.download()
  await ui.download()
  assert.equal(ui.view.busy, true)
  choose('flac')
  await first
  assert.equal(ui.calls.length, 1)
  assert.equal(ui.view.selection.selectedItems().length, 0)
  assert.equal(ui.view.busy, false)
})

test('replaced list cannot submit an old selection after quality selection resolves', async () => {
  let choose!: (quality: string) => void
  const pending = new Promise<string>(resolve => { choose = resolve })
  const ui = downloadUI(() => pending)
  const task = ui.download()
  ui.views.set(ui.container, {})
  choose('flac')
  await task
  assert.equal(ui.calls.length, 0)
})

test('malformed response cannot be treated as successful submission', async () => {
  const { submitBatchDownloads } = helpers()
  const result = await submitBatchDownloads(songs(2), 'flac', async () => ({}))
  assert.equal(result.accepted.length, 0)
  assert.equal(result.uncertain.length, 2)
})
