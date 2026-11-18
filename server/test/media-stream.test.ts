import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { mediaMime, proxyMediaStream } from '../src/core/media-stream.js'

async function request(upstream: Response | Error, headers = {}, suffix = 'mp4') {
  const app = Fastify()
  let sent: RequestInit | undefined
  app.get('/stream', (req, reply) => proxyMediaStream(req, reply, 'https://example.test/media', suffix, (async (_url, init) => {
    sent = init
    if (upstream instanceof Error) throw upstream
    return upstream
  }) as typeof fetch))
  try {
    const response = await app.inject({ url: '/stream', headers })
    return { response, headers: new Headers(sent?.headers) }
  } finally { await app.close() }
}

test('audio/video suffix MIME types and unknown formats', () => {
  assert.equal(mediaMime('MP4'), 'video/mp4')
  assert.equal(mediaMime('.webm'), 'video/webm')
  assert.equal(mediaMime('mp3'), 'audio/mpeg')
  assert.equal(mediaMime('m4a'), 'audio/mp4')
  assert.equal(mediaMime('mkv'), 'video/x-matroska')
  assert.equal(mediaMime(), 'application/octet-stream')
})

test('full media preserves body and upstream content type', async () => {
  const { response } = await request(new Response('video', { headers: { 'Content-Type': 'video/webm', 'Content-Length': '5', 'Accept-Ranges': 'bytes' } }))
  assert.equal(response.statusCode, 200)
  assert.equal(response.body, 'video')
  assert.equal(response.headers['content-type'], 'video/webm')
  assert.equal(response.headers['accept-ranges'], 'bytes')
  assert.equal(response.headers['content-length'], '5')
})

test('missing upstream MIME falls back to video suffix', async () => {
  const { response } = await request(new Response(new Uint8Array([1, 2, 3])))
  assert.equal(response.headers['content-type'], 'video/mp4')
})

test('range and validators are forwarded with 206 and response range headers', async () => {
  const { response, headers } = await request(new Response('abc', { status: 206, headers: {
    'Content-Range': 'bytes 2-4/9', 'Content-Length': '3', 'Accept-Ranges': 'bytes', ETag: '"test"', 'Last-Modified': 'Wed, 18 Nov 2026 00:00:00 GMT',
  } }), { range: 'bytes=2-4', 'if-range': '"test"' })
  assert.equal(headers.get('range'), 'bytes=2-4')
  assert.equal(headers.get('if-range'), '"test"')
  assert.equal(response.statusCode, 206)
  assert.equal(response.body, 'abc')
  assert.equal(response.headers['content-range'], 'bytes 2-4/9')
  assert.equal(response.headers.etag, '"test"')
})

test('unsatisfiable range stays 416 with total size', async () => {
  const { response } = await request(new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */9' } }), { range: 'bytes=99-' })
  assert.equal(response.statusCode, 416)
  assert.equal(response.headers['content-range'], 'bytes */9')
})

test('upstream ignores range: preserve 200 instead of inventing 206', async () => {
  const { response } = await request(new Response('all'), { range: 'bytes=2-' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.body, 'all')
})

test('upstream failures return 502', async () => {
  assert.equal((await request(new Response(null, { status: 404 }))).response.statusCode, 502)
  assert.equal((await request(new Error('offline'))).response.statusCode, 502)
})
