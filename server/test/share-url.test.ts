import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseShareUrl } from '../src/core/playlist-square/share-url.js'

const examples = [
  ['https://music.163.com/playlist?id=123&userid=456', 'wy'],
  ['分享歌单《经典》 https://music.163.com/#/playlist?id=123 （来自网易云）', 'wy'],
  ['https://music.163.com/m/playlist?id=123', 'wy'],
  ['https://y.qq.com/n/ryqq/playlist/123', 'tx'],
  ['https://y.qq.com/n/yqq/playsquare/123.html', 'tx'],
  ['https://y.qq.com/n/m/detail/taoge/index.html?id=123', 'tx'],
  ['https://www.kugou.com/yy/special/single/123.html', 'kg'],
  ['https://www.kugou.com/speciallist/single/example-id-123.html', 'kg'],
  ['https://www.kuwo.cn/playlist_detail/123', 'kw'],
  ['https://www.kuwo.cn/play_detail/123', 'kw'],
  ['https://music.migu.cn/v3/music/playlist/123', 'mg'],
]
for (const [url, platform] of examples) test(url!, () => {
  assert.deepEqual(parseShareUrl(url!), { platform, id: '123' })
})
for (const input of [
  '经典', 'https://music.163.com/song?id=123',
  'https://music.163.com.evil.test/playlist?id=123',
  'https://evil.test/music.163.com/playlist?id=123',
  'https://music.163.com/playlist?id=123abc',
  'https://music.163.com/playlist?id=0',
  'https://www.kuwo.cn/song_detail/123',
  'https://y.qq.com/n/ryqq/songDetail/123',
  'https://music.163.com:8080/playlist?id=123',
  'https://user:pass@music.163.com/playlist?id=123',
  'https://163cn.tv/abc',
]) test(`reject ${input}`, () => assert.equal(parseShareUrl(input), null))

import { resolveShareUrl } from '../src/core/playlist-square/share-url.js'
test('expands the supplied NetEase short link', async () => {
  const calls: string[] = []
  const request = (async (url, options) => {
    calls.push(String(url))
    assert.equal(options?.redirect, 'manual')
    return new Response(null, { status: 302, headers: { location: 'https://y.music.163.com/m/playlist?id=18540106430&userid=1305578112' } })
  }) as typeof fetch
  assert.deepEqual(await resolveShareUrl('分享歌单 https://163cn.tv/bj8u7E1P', request), { platform: 'wy', id: '18540106430' })
  assert.deepEqual(calls, ['https://163cn.tv/bj8u7E1P'])
})
for (const target of ['http://127.0.0.1/private', 'https://163cn.tv.evil.test/a', 'https://user:pass@163cn.tv/a', 'https://163cn.tv:8080/a']) {
  test(`does not follow unsafe redirect ${target}`, async () => {
    let count = 0
    const request = (async () => { count++; return new Response(null, { status: 302, headers: { location: target } }) }) as typeof fetch
    await assert.rejects(resolveShareUrl('https://163cn.tv/abc', request), /不受支持/)
    assert.equal(count, 1)
  })
}
test('rejects redirect loops', async () => {
  const request = (async () => new Response(null, { status: 302, headers: { location: '/abc' } })) as typeof fetch
  await assert.rejects(resolveShareUrl('https://163cn.tv/abc', request), /循环跳转/)
})
test('reports expired links and request failures', async () => {
  await assert.rejects(resolveShareUrl('https://163cn.tv/abc', (async () => new Response(null, { status: 404 })) as typeof fetch), /失效/)
  await assert.rejects(resolveShareUrl('https://163cn.tv/abc', (async () => { throw new Error('timeout') }) as typeof fetch), /展开失败/)
})
