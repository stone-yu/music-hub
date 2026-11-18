import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { readLibrarySongs, type LibraryProgress } from '../src/core/library/reader.js'

test('reader reports actual counts and artist completion, preserving song metadata', async () => {
  const updates: LibraryProgress[] = []
  const songs = await readLibrarySongs({
    getArtists: async () => [{ id: 'a' }, { id: 'b' }],
    getArtist: async id => ({ artist: { name: id, album: [{ id: id + '1', name: 'Album' }] } }),
    getAlbum: async id => ({ album: { coverArt: 'cover', song: [{ id, title: 'Song', suffix: 'mp4', duration: 12, playCount: 3, created: '2026-11-18' }] } }),
  }, progress => updates.push(progress))
  assert.deepEqual(updates[0], { phase: 'artists', processedArtists: 0, totalArtists: 0, songsRead: 0 })
  assert.deepEqual(updates.at(-1), { phase: 'songs', processedArtists: 2, totalArtists: 2, songsRead: 2 })
  assert.ok(updates.some(p => p.processedArtists === 1 && p.songsRead === 1))
  assert.equal(songs[0].artist, 'a')
  assert.equal(songs[0].album, 'Album')
  assert.equal(songs[0].coverArt, 'cover')
  assert.equal(songs[0].suffix, 'mp4')
  assert.equal(songs[0].playCount, 3)
})

test('missing artists/albums still advance traversal, empty library has no fabricated total', async () => {
  const updates: LibraryProgress[] = []
  const source = {
    getArtists: async () => [{ id: 'missing' }, { id: 'empty-album' }],
    getArtist: async id => id === 'missing' ? null : { artist: { album: [{ id: 'empty' }] } },
    getAlbum: async () => null,
  }
  assert.deepEqual(await readLibrarySongs(source, p => updates.push(p)), [])
  assert.equal(updates.at(-1)?.processedArtists, 2)
  assert.equal(updates.at(-1)?.songsRead, 0)
  const empty: LibraryProgress[] = []
  await readLibrarySongs({ ...source, getArtists: async () => [] }, p => empty.push(p))
  assert.equal(empty.at(-1)?.totalArtists, 0)
})

function progressUI() {
  const nodes = new Map<string, any>()
  const $ = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: true, value: null, textContent: '', innerHTML: '', title: '',
      classList: { contains: () => true },
      removeAttribute(name: string) { this[name] = null },
      append(text: string) { this.textContent += text },
    })
    return nodes.get(id)
  }
  let homeLoads = 0
  const responses: any[] = []
  const code = readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8')
    .split('// ---------- 顶部条：曲库状态 + 个人中心 ----------')[1].split('function refreshLibraryTop()')[0]
  const context = vm.createContext({ $, document: { createTextNode: (s: string) => s }, fetchJSON: async () => responses.shift(), loadHome: () => { homeLoads++ } })
  vm.runInContext(code, context)
  return { $, responses, run: (s: string) => vm.runInContext(s, context), homeLoads: () => homeLoads }
}

test('home and top show real progress and automatically refresh recommendations after sync', async () => {
  const ui = progressUI()
  ui.responses.push({ connected: true, libraryLoading: true, librarySize: 0, libraryProgress: { phase: 'songs', processedArtists: 140, totalArtists: 334, songsRead: 390 } })
  assert.equal(await ui.run('checkTopStatus()'), true)
  assert.equal(ui.$('#home-library-sync').hidden, false)
  assert.match(ui.$('#home-sync-text').textContent, /140\/334（41%）· 已读取 390 首/)
  assert.ok(ui.$('#home-sync-progress').value > 41)
  assert.match(ui.$('#status-indicator').textContent, /同步中/)
  ui.responses.push({ connected: true, libraryLoading: false, librarySize: 900 })
  assert.equal(await ui.run('checkTopStatus()'), false)
  assert.equal(ui.$('#home-library-sync').hidden, true)
  assert.equal(ui.homeLoads(), 1)
  ui.responses.push({ connected: true, libraryLoading: false, librarySize: 900 })
  await ui.run('checkTopStatus()')
  assert.equal(ui.homeLoads(), 1)
})

test('unknown totals use indeterminate progress and scan phase has clear text', () => {
  const ui = progressUI()
  ui.run('updateHomeLibraryProgress({libraryLoading:true,libraryProgress:{phase:"artists"}})')
  assert.equal(ui.$('#home-sync-progress').value, null)
  assert.match(ui.$('#home-sync-text').textContent, /获取艺术家/)
  ui.run('updateHomeLibraryProgress({libraryLoading:true,libraryProgress:{phase:"scan"}})')
  assert.match(ui.$('#home-sync-text').textContent, /扫描媒体/)
})
