import type { FastifyReply, FastifyRequest } from 'fastify'

const SUFFIX_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', m4a: 'audio/mp4', m4b: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
  mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
}

export function mediaMime(suffix?: string | null): string {
  return SUFFIX_MIME[(suffix ?? '').replace(/^\./, '').toLowerCase()] || 'application/octet-stream'
}

/** Preserve upstream byte ranges: video seeking must not become an unconditional 200. */
export async function proxyMediaStream(
  req: FastifyRequest,
  reply: FastifyReply,
  url: string,
  suffix?: string | null,
  fetcher: typeof fetch = fetch,
): Promise<FastifyReply> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  reply.raw.once('close', abort)
  try {
    const headers = new Headers({ 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity' })
    for (const name of ['range', 'if-range']) {
      const value = req.headers[name]
      if (typeof value === 'string') headers.set(name, value)
    }
    const upstream = await fetcher(url, { headers, signal: controller.signal })
    if (upstream.status === 416) {
      const range = upstream.headers.get('content-range')
      if (range) reply.header('Content-Range', range)
      await upstream.body?.cancel()
      return reply.code(416).send()
    }
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel()
      return reply.code(502).send({ error: `upstream ${upstream.status}` })
    }
    reply.code(upstream.status)
    reply.header('Content-Type', upstream.headers.get('content-type') || mediaMime(suffix))
    for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name)
      if (value) reply.header(name, value)
    }
    return reply.send(upstream.body)
  } catch (err) {
    if (controller.signal.aborted) return reply
    return reply.code(502).send({ error: (err as Error).message })
  }
}
