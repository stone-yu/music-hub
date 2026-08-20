# 广播电台 (Radio Stations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 MusicHub 新增「广播电台」一级菜单，含「网络电台」(radio5.cn，分类筛选+全站搜索+HLS播放) 和「本地电台」(Navidrome getInternetRadioStations，直链mp3播放) 两个二级子菜单。

**Architecture:** 后端新增 `core/radio5/` 模块（needle 抓取分类页 HTML + 调 radio5 REST API 取流/搜索，带内存缓存）和 `routes/radio.ts`；扩展 `navidrome/client.ts` 增加电台列表方法。前端新增两个视图 + 引入本地化 hls.js，在现有全局播放器 `playCurrent()` 中新增 kind:'radio' 分支处理 HLS/mp3 直播流。

**Tech Stack:** Node.js + Fastify + TypeScript (后端)、needle (HTTP 抓取)、原生 HTML/CSS/JS + hls.js (前端)、Subsonic API (Navidrome 电台)。

**Spec:** docs/superpowers/specs/2026-08-20-radio-stations-design.md

## Global Constraints

- 后端模块用 ESM（import，.js 扩展名引用，项目 type: module），TypeScript 严格类型；所有 needle 请求带 Referer: https://radio5.cn/ 与浏览器 UA。
- radio5 域名固定 https://radio5.cn（硬编码，不进 config）。
- 前端无框架，原生 JS；新增外部库 hls.js 本地化到 web/vendor/hls.min.js（不引 CDN，适配 Docker 自托管，Dockerfile 已 COPY web /app/web）。
- 复用现有工具：前端 fetchJSON(url, opts)、escapeHtml(str)、coverHtml(img)、toast(msg)、startQueue(items, plInfo)、playCurrent() 的 item.kind 分流机制；后端 navidromeClient.get(endpoint) 私有方法模式。
- 项目无测试框架（package.json 无 test 脚本，无测试依赖）；验证用 npm run typecheck + 启动服务实测。
- 每个任务结束提交一次 commit。

---

## File Structure

**新增（后端）：**
- `server/src/core/radio5/catalog.ts` — 静态分类目录（快捷标签5 + 四维：级别6/地区35/类型10/语言15），纯数据无依赖。
- `server/src/core/radio5/client.ts` — radio5 抓取/API 客户端：getStationsByCategory(path)、searchStations(q)、getStream(slug)，带内存缓存。
- `server/src/routes/radio.ts` — 5 个 REST 接口：categories / stations / search / stream / navidrome radio。

**新增（前端）：**
- `web/vendor/hls.min.js` — hls.js 库本地化文件（任务中给出获取命令）。

**修改（后端）：**
- `server/src/core/navidrome/client.ts` — 新增 getInternetRadioStations() 方法。
- `server/src/index.ts` — 注册 radioRoutes。

**修改（前端）：**
- `web/index.html` — 侧边栏菜单组 + 两个视图区 + 引入 hls.js。
- `web/app.js` — 两个视图逻辑 + 播放器 HLS 分支。
- `web/style.css` — 电台卡片 + 筛选区 + 直播流态样式。

---

## Task 1: 静态分类目录 catalog.ts

**Files:**
- Create: `server/src/core/radio5/catalog.ts`

**Interfaces:**
- Produces: `radioCatalog` 常量、`Catalog` / `CategoryOption` 类型，供 Task 3 路由返回给前端。

- [ ] **Step 1: 创建目录与文件**

创建 `server/src/core/radio5/catalog.ts`，写入：

```ts
/**
 * radio5.cn 静态分类目录
 * 数据来源：https://radio5.cn/fm/radio-type （总枢纽页，分类稳定，硬编码不每次抓取）
 * path 是 radio5 上对应分类的 URL 子路径（不含域名），抓取时拼成 https://radio5.cn/{path}
 */
export interface CategoryOption {
  label: string
  path: string
}

export interface Catalog {
  quick: CategoryOption[]      // 5 个快捷标签（/fm/ 路径）
  level: CategoryOption[]      // 电台级别（/level/）
  area: CategoryOption[]       // 地区（/area/）
  type: CategoryOption[]       // 电台类型（/radio/）
  language: CategoryOption[]   // 主播语言（/language/）
}

export const radioCatalog: Catalog = {
  quick: [
    { label: '央媒', path: 'fm/cmg' },
    { label: '省台', path: 'fm/province' },
    { label: '港澳台', path: 'fm/hk' },
    { label: '热门城市台', path: 'fm/city' },
    { label: '市县台', path: 'fm/市县台' },
  ],
  level: [
    { label: '国家级', path: 'level/g' },
    { label: '省台', path: 'level/s' },
    { label: '市县台', path: 'level/x' },
    { label: '港澳台', path: 'level/hk' },
    { label: '热门城市台', path: 'level/c' },
    { label: '网络台', path: 'level/net' },
  ],
  area: [
    { label: '中央', path: 'area/cn' },
    { label: '北京', path: 'area/bj' },
    { label: '上海', path: 'area/sh' },
    { label: '天津', path: 'area/tj' },
    { label: '重庆', path: 'area/cq' },
    { label: '广东', path: 'area/gd' },
    { label: '江苏', path: 'area/js' },
    { label: '浙江', path: 'area/zj' },
    { label: '山东', path: 'area/sd' },
    { label: '河北', path: 'area/hb' },
    { label: '河南', path: 'area/hn' },
    { label: '辽宁', path: 'area/ln' },
    { label: '四川', path: 'area/sc' },
    { label: '福建', path: 'area/fj' },
    { label: '安徽', path: 'area/ah' },
    { label: '吉林', path: 'area/jl' },
    { label: '陕西', path: 'area/sx' },
    { label: '湖北', path: 'area/hubei' },
    { label: '山西', path: 'area/sxi' },
    { label: '湖南', path: 'area/hunan' },
    { label: '黑龙江', path: 'area/hlj' },
    { label: '江西', path: 'area/jx' },
    { label: '新疆', path: 'area/xj' },
    { label: '青海', path: 'area/qh' },
    { label: '广西', path: 'area/gx' },
    { label: '云南', path: 'area/yn' },
    { label: '贵州', path: 'area/gz' },
    { label: '宁夏', path: 'area/nx' },
    { label: '海南', path: 'area/hainan' },
    { label: '甘肃', path: 'area/gs' },
    { label: '西藏', path: 'area/xz' },
    { label: '内蒙古', path: 'area/nmg' },
    { label: '香港', path: 'area/hk' },
    { label: '澳门', path: 'area/macao' },
    { label: '台湾', path: 'area/tw' },
  ],
  type: [
    { label: '音乐', path: 'radio/music' },
    { label: '新闻综合', path: 'radio/news' },
    { label: '交通', path: 'radio/traffic' },
    { label: '生活', path: 'radio/life' },
    { label: '财经', path: 'radio/financial' },
    { label: '文艺|曲艺', path: 'radio/art' },
    { label: '都市', path: 'radio/city' },
    { label: '文体旅游', path: 'radio/cst' },
    { label: '乡村', path: 'radio/village' },
    { label: '青少科教', path: 'radio/youth' },
  ],
  language: [
    { label: '汉·普通话', path: 'language/cn' },
    { label: '汉·粤语', path: 'language/hk' },
    { label: '汉·方言|民族语', path: 'language/my' },
    { label: 'English', path: 'language/en' },
    { label: 'Bahasa Melayu', path: 'language/my-2' },
    { label: 'French', path: 'language/fr' },
    { label: 'Arabic', path: 'language/ar' },
    { label: 'Russian', path: 'language/ru' },
    { label: 'Spanish', path: 'language/es' },
    { label: 'Vietnamese', path: 'language/vn' },
    { label: 'German', path: 'language/de' },
    { label: 'Japanese', path: 'language/jp' },
    { label: 'Korean', path: 'language/kr' },
    { label: 'Italian', path: 'language/it' },
    { label: 'Portuguese', path: 'language/pt' },
  ],
}
```

注：`市县台` 快捷标签 path 含中文 `fm/市县台`，由路由层 encodeURIComponent 编码后拼 URL（Task 3 处理）。Italian 原 radio5 数据指向 en（页面数据错误），此处修正为独立 `language/it`（不存在则 radio5 返回空，不影响其他）。

- [ ] **Step 2: typecheck 验证**

Run: `cd server && npm run typecheck`
Expected: 无新增错误（新文件无依赖，应直接通过）。

- [ ] **Step 3: Commit**

```bash
git add server/src/core/radio5/catalog.ts
git commit -m "feat(radio): add radio5 static category catalog"
```

---

## Task 2: radio5 抓取/API 客户端 client.ts

**Files:**
- Create: `server/src/core/radio5/client.ts`

**Interfaces:**
- Consumes: needle（已有依赖）、logger（`../logger.js`）。
- Produces: `RadioStation`、`RadioStream` 类型；`radio5Client` 单例，方法 `getStationsByCategory(path)`、`searchStations(q)`、`getStream(slug)`。供 Task 3 路由调用。

- [ ] **Step 1: 创建 client.ts**

创建 `server/src/core/radio5/client.ts`，写入：

```ts
/**
 * radio5.cn 抓取/API 客户端
 *
 * 数据链路（已实测验证）：
 *  - 电台列表：分类页 https://radio5.cn/{path} 是 SSR HTML，每个电台条目同时带
 *    post-XXXX(数字id) + data-url=".../play/radio/{slug}" + 封面 + 标题，正则解析。
 *  - 取流：GET https://radio5.cn/api/play/play/{数字id}，仅需 Referer 头，返回 stream_url(m3u8)。
 *    key 时效鉴权，每次调用返回新 key，故 streamUrl 不缓存。
 *  - 搜索：GET https://radio5.cn/api/play/search?s={kw}，返回 [{title,url(含slug),thumbnail}]。
 *  - slug→id：抓 https://radio5.cn/play/radio/{slug} 取 body class 的 postid-XXXX。post id 稳定，长缓存。
 *
 * 缓存：分类列表内存缓存 10 分钟；slug→id 映射长缓存（随进程生命周期）；streamUrl 不缓存。
 */
import needle from 'needle'
import { logger } from '../logger.js'

const BASE = 'https://radio5.cn'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

export interface RadioStation {
  id: string        // 数字 post id（搜索结果无 id 时为空串）
  slug: string      // URL slug（如 cnr-zgzs）
  name: string      // 电台名
  cover: string     // 封面完整 URL（已补全域名）
  artist?: string   // 机构（能解析到则填）
}

export interface RadioStream {
  streamUrl: string  // m3u8 直播流地址（带时效 key）
  title: string
  cover: string
  artist: string
  isHls: true
}

// 分类列表缓存：path → { list, ts }
const stationCache = new Map<string, { list: RadioStation[]; ts: number }>()
const STATION_TTL = 10 * 60 * 1000

// slug → 数字 post id，长缓存
const slugIdCache = new Map<string, string>()

/** 通用 needle GET，返回 HTML 字符串或 JSON 对象 */
async function fetchText(pathOrUrl: string, timeout = 20_000): Promise<string> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}/${pathOrUrl}`
  const resp = await needle('get', url, null, {
    response_timeout: timeout,
    follow_max: 3,
    rejectUnauthorized: false,
    headers: { 'User-Agent': UA, Referer: BASE + '/' },
  })
  return typeof resp.body === 'string' ? resp.body : String(resp.body ?? '')
}

async function fetchJson(pathOrUrl: string, timeout = 15_000): Promise<any> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}/${pathOrUrl}`
  const resp = await needle('get', url, null, {
    response_timeout: timeout,
    follow_max: 3,
    rejectUnauthorized: false,
    json: true,
    headers: { 'User-Agent': UA, Referer: BASE + '/' },
  })
  return resp.body
}

/** 补全为完整 URL（radio5 内部相对路径以 / 开头） */
function absUrl(u: string): string {
  if (!u) return ''
  if (u.startsWith('http')) return u
  if (u.startsWith('//')) return 'https:' + u
  if (u.startsWith('/')) return BASE + u
  return BASE + '/' + u
}

class Radio5Client {
  /**
   * 按分类路径抓取电台列表。
   * 正则解析每个 post-XXXX 容器内的 data-url(slug) + img(封面) + 标题。
   */
  async getStationsByCategory(path: string): Promise<RadioStation[]> {
    const cached = stationCache.get(path)
    if (cached && Date.now() - cached.ts < STATION_TTL) return cached.list
    try {
      const html = await fetchText(path)
      const list = parseStationList(html)
      stationCache.set(path, { list, ts: Date.now() })
      return list
    } catch (err) {
      logger.warn({ path, err: (err as Error).message }, '[radio5] getStationsByCategory failed')
      return []
    }
  }

  /** 全站搜索电台 */
  async searchStations(q: string): Promise<RadioStation[]> {
    if (!q?.trim()) return []
    try {
      const data = await fetchJson(`/api/play/search?s=${encodeURIComponent(q.trim())}`)
      if (!Array.isArray(data)) return []
      return data.map((it: any): RadioStation => {
        const slug = extractSlug(it.url)
        // thumbnail 是 <img src="...">，提取 src
        const coverMatch = String(it.thumbnail || '').match(/src="([^"]+)"/)
        return {
          id: '',
          slug,
          name: String(it.title || '').trim(),
          cover: absUrl(coverMatch ? coverMatch[1] : ''),
          artist: '',
        }
      }).filter((s: RadioStation) => s.slug && s.name)
    } catch (err) {
      logger.warn({ q, err: (err as Error).message }, '[radio5] searchStations failed')
      return []
    }
  }

  /**
   * 取播放流：slug → 数字id → /api/play/play/{id} → stream_url
   * streamUrl 含时效 key，每次现取，不缓存。
   */
  async getStream(slug: string): Promise<RadioStream | null> {
    const id = await this.resolveId(slug)
    if (!id) return null
    try {
      const data = await fetchJson(`/api/play/play/${id}`)
      if (!data?.stream_url) {
        logger.warn({ slug, id }, '[radio5] getStream no stream_url')
        return null
      }
      return {
        streamUrl: String(data.stream_url),
        title: String(data.title || ''),
        cover: absUrl(String(data.artwork_url || '')),
        artist: String(data.artist || ''),
        isHls: true,
      }
    } catch (err) {
      logger.warn({ slug, id, err: (err as Error).message }, '[radio5] getStream failed')
      return null
    }
  }

  /** slug → 数字 post id，优先长缓存，未命中抓播放页解析 body class 的 postid-XXXX */
  private async resolveId(slug: string): Promise<string | null> {
    const cached = slugIdCache.get(slug)
    if (cached) return cached
    try {
      const html = await fetchText(`/play/radio/${slug}`)
      const m = html.match(/postid-(\d+)/)
      if (m) {
        slugIdCache.set(slug, m[1]!)
        return m[1]!
      }
      logger.warn({ slug }, '[radio5] resolveId no postid found')
      return null
    } catch (err) {
      logger.warn({ slug, err: (err as Error).message }, '[radio5] resolveId failed')
      return null
    }
  }
}

/** 从列表页 HTML 解析电台条目 */
function parseStationList(html: string): RadioStation[] {
  const list: RadioStation[] = []
  // 匹配 post-XXXX 容器块（radio5 列表项 class 含 post-数字）
  const blockRe = /post-(\d+)[\s\S]*?(?=post-\d+|<\/(?:main|section|div)\s+class="(?:site|main)|$)/g
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = blockRe.exec(html)) !== null) {
    const block = blockMatch[0]
    const id = blockMatch[1]!
    // data-url="https://radio5.cn/play/radio/{slug}"
    const urlMatch = block.match(/data-url="https:\/\/radio5\.cn\/play\/radio\/([^"\/]+)"/)
    if (!urlMatch) continue
    const slug = urlMatch[1]!
    // 封面：<img ... src="..."> 取第一个 src
    const imgMatch = block.match(/<img[^>]+src="([^"]+)"/)
    const cover = absUrl(imgMatch ? imgMatch[1] : '')
    // 标题：优先 alt，其次 title 文本节点
    const altMatch = block.match(/alt="([^"]+)"/)
    const titleMatch = block.match(/<h[2-4][^>]*>([^<]+)<\/h[2-4]>/)
    const name = (altMatch ? altMatch[1] : titleMatch ? titleMatch[1] : '').trim()
    if (slug && name) {
      list.push({ id, slug, name, cover, artist: '' })
    }
  }
  return list
}

/** 从 url（如 https://radio5.cn/play/radio/cnr-zgzs）提取 slug */
function extractSlug(url: string): string {
  const m = String(url || '').match(/\/play\/radio\/([^"\/]+)/)
  return m ? m[1]! : ''
}

export const radio5Client = new Radio5Client()
```

- [ ] **Step 2: typecheck 验证**

Run: `cd server && npm run typecheck`
Expected: 无类型错误。

- [ ] **Step 3: 实测抓取（临时脚本验证）**

在 server 目录运行临时验证（不写进仓库）：

```bash
cd server && npx tsx -e "
import { radio5Client } from './src/core/radio5/client.js'
import { radioCatalog } from './src/core/radio5/catalog.js'
const list = await radio5Client.getStationsByCategory('fm/cmg')
console.log('央媒电台数:', list.length)
console.log('前3个:', JSON.stringify(list.slice(0,3), null, 2))
const s = await radio5Client.getStream('cnr-zgzs')
console.log('取流:', s ? s.streamUrl.slice(0,70)+'...' : '失败')
const r = await radio5Client.searchStations('音乐')
console.log('搜索音乐:', r.length, '条, 首条:', r[0]?.name)
"
```
Expected: 央媒电台数约 19；取流输出 ytcast2.radio.cn 的 m3u8；搜索返回若干条。验证后删除无遗留文件（tsx -e 不产生文件）。

- [ ] **Step 4: Commit**

```bash
git add server/src/core/radio5/client.ts
git commit -m "feat(radio): add radio5 scraper/stream/search client"
```

---

## Task 3: 扩展 Navidrome 客户端 — getInternetRadioStations

**Files:**
- Modify: `server/src/core/navidrome/client.ts`（在 `getStarredSongIds` 方法附近新增）

**Interfaces:**
- Consumes: 现有私有 `get(endpoint)` 方法（Subsonic API）。
- Produces: `navidromeClient.getInternetRadioStations()`，返回 `{id,name,streamUrl,homepageUrl}[]`。供 Task 4 路由调用。

- [ ] **Step 1: 新增方法**

在 `server/src/core/navidrome/client.ts` 中，`getStarredSongIds` 方法之后（约 line 180 前）插入：

```ts
  /** 获取网络电台列表（广播电台功能用，Subsonic getInternetRadioStations） */
  async getInternetRadioStations(): Promise<{ id: string; name: string; streamUrl: string; homepageUrl?: string }[]> {
    const r = await this.get('getInternetRadioStations')
    if (!r) return []
    const stations = r.internetRadioStations?.internetRadioStation ?? []
    return stations.map((s: any) => ({
      id: String(s.id ?? ''),
      name: String(s.name ?? ''),
      streamUrl: String(s.streamUrl ?? ''),
      homepageUrl: s.homepageUrl ? String(s.homepageUrl) : undefined,
    })).filter((s: any) => s.streamUrl)
  }
```

- [ ] **Step 2: typecheck 验证**

Run: `cd server && npm run typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add server/src/core/navidrome/client.ts
git commit -m "feat(navidrome): add getInternetRadioStations"
```

---

## Task 4: 广播电台路由 routes/radio.ts

**Files:**
- Create: `server/src/routes/radio.ts`

**Interfaces:**
- Consumes: `radio5Client`（Task 2）、`radioCatalog`（Task 1）、`navidromeClient`（Task 3）、`FastifyInstance`。
- Produces: `radioRoutes` 导出函数。供 Task 5 注册。

- [ ] **Step 1: 创建路由文件**

创建 `server/src/routes/radio.ts`，写入：

```ts
/**
 * 广播电台路由
 *   GET /api/v1/radio5/categories                     分类目录（快捷标签 + 四维，静态）
 *   GET /api/v1/radio5/stations?cat={path}            按分类抓电台列表（cat 为 radio5 子路径，已编码）
 *   GET /api/v1/radio5/search?q={keyword}             全站搜索电台
 *   GET /api/v1/radio5/stream/:slug                   解析 slug→id→streamUrl，返回播放流地址（时效 key）
 *   GET /api/v1/navidrome/radio                       Navidrome 网络电台列表（直链 mp3）
 */
import type { FastifyInstance } from 'fastify'
import { radio5Client } from '../core/radio5/client.js'
import { radioCatalog } from '../core/radio5/catalog.js'
import { navidromeClient } from '../core/navidrome/client.js'

interface StationsQuery {
  cat?: string
}
interface SearchQuery {
  q?: string
}

export async function radioRoutes(app: FastifyInstance): Promise<void> {
  // 分类目录（静态，纯数据返回）
  app.get('/api/v1/radio5/categories', async () => {
    return radioCatalog
  })

  // 按分类抓电台列表
  app.get<{ Querystring: StationsQuery }>('/api/v1/radio5/stations', async (req, reply) => {
    const { cat } = req.query
    if (!cat?.trim()) return reply.code(400).send({ error: 'cat (category path) is required' })
    // cat 已由前端 encodeURIComponent 编码（含中文如 fm/市县台），decode 后传给 client
    const path = decodeURIComponent(cat.trim())
    const list = await radio5Client.getStationsByCategory(path)
    return { total: list.length, stations: list }
  })

  // 全站搜索电台
  app.get<{ Querystring: SearchQuery }>('/api/v1/radio5/search', async (req, reply) => {
    const { q } = req.query
    if (!q?.trim()) return reply.code(400).send({ error: 'q (keyword) is required' })
    const list = await radio5Client.searchStations(q.trim())
    return { total: list.length, stations: list }
  })

  // 取播放流（slug → id → streamUrl，时效 key 现取）
  app.get<{ Params: { slug: string } }>('/api/v1/radio5/stream/:slug', async (req, reply) => {
    const stream = await radio5Client.getStream(req.params.slug)
    if (!stream) return reply.code(502).send({ error: '解析电台流失败' })
    return stream
  })

  // Navidrome 网络电台列表（直链 mp3，前端原生 audio 播放）
  app.get('/api/v1/navidrome/radio', async (req, reply) => {
    const connected = await navidromeClient.ping()
    if (!connected) return reply.code(502).send({ error: 'Navidrome 连接失败' })
    try {
      const stations = await navidromeClient.getInternetRadioStations()
      return { total: stations.length, stations }
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message })
    }
  })
}
```

- [ ] **Step 2: typecheck 验证**

Run: `cd server && npm run typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/radio.ts
git commit -m "feat(radio): add radio routes (radio5 + navidrome)"
```

---

## Task 5: 注册路由到 index.ts

**Files:**
- Modify: `server/src/index.ts`（import + register 两处）

**Interfaces:**
- Consumes: `radioRoutes`（Task 4）。

- [ ] **Step 1: 加 import**

在 `server/src/index.ts` 的 import 区（`import { rankRoutes } ...` 之后，约 line 19 后）加：

```ts
import { radioRoutes } from './routes/radio.js'
```

- [ ] **Step 2: 加 register**

在 register 区（`await app.register(rankRoutes)` 之后，约 line 63 后，静态资源注册之前）加：

```ts
  await app.register(radioRoutes)
```

- [ ] **Step 3: typecheck + 启动验证**

Run: `cd server && npm run typecheck`
Expected: 无错误。

启动服务验证路由可达（本地需带 CONFIG_PATH）：

```bash
cd server && CONFIG_PATH=../config.yaml npx tsx src/index.ts &
sleep 3
# radio5 分类目录
curl -s http://localhost:23330/api/v1/radio5/categories | head -c 200
echo ""
# radio5 央媒电台列表
curl -s "http://localhost:23330/api/v1/radio5/stations?cat=fm%2Fcmg" | head -c 300
echo ""
# navidrome 电台
curl -s http://localhost:23330/api/v1/navidrome/radio | head -c 300
kill %1 2>/dev/null
```
Expected: categories 返回 JSON 目录；stations 返回央媒电台数组；navidrome/radio 返回 2 个电台。

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(radio): register radio routes in server bootstrap"
```

---

## Task 6: 引入 hls.js 本地化

**Files:**
- Create: `web/vendor/hls.min.js`

**Interfaces:**
- Produces: 全局 `window.Hls`（前端播放器 Task 8 使用）。

- [ ] **Step 1: 下载 hls.js min 版到 vendor 目录**

```bash
mkdir -p web/vendor
# hls.js@1.5.x min 版（约 130KB），本地化，无 CDN 运行时依赖
curl -fsSL "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js" -o web/vendor/hls.min.js
# 校验非空且是 JS
head -c 80 web/vendor/hls.min.js
wc -c web/vendor/hls.min.js
```
Expected: 文件约 130KB+，首行是压缩 JS（非 404 HTML）。

- [ ] **Step 2: Commit**

```bash
git add web/vendor/hls.min.js
git commit -m "feat(radio): vendor hls.js for HLS live stream playback"
```

---

## Task 7: 前端 HTML — 菜单 + 视图 + hls.js 引入

**Files:**
- Modify: `web/index.html`（侧边栏菜单组、两个视图区、script 引入）

**Interfaces:**
- Produces: `#view-net-radio`、`#view-local-radio` 视图 DOM；`data-tab="net-radio"` / `data-tab="local-radio"` 菜单项。

- [ ] **Step 1: 侧边栏新增菜单组**

在 `web/index.html` 的「本地曲库」菜单组 `</div>`（约 line 30，`data-group="local"` 的闭合）之后、`</aside>` 之前插入：

```html
    <div class="menu-group" data-group="radio">
      <div class="menu-group-head"><svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 3.1A10 10 0 0 1 4.9 21"/><path d="M7.8 6.3a6 6 0 0 0 0 11.4"/><circle cx="12" cy="12" r="2"/><path d="M12 11V3"/><path d="M16.2 6.3a6 6 0 0 1 0 11.4"/><path d="M19.1 3.1A10 10 0 0 0 19.1 21"/></svg><span class="menu-text">广播电台</span><svg class="menu-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></div>
      <div class="menu-group-body">
        <a href="#" class="menu-item" data-tab="net-radio"><svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/></svg><span class="menu-text">网络电台</span></a>
        <a href="#" class="menu-item" data-tab="local-radio"><svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14a9 9 0 0 1 18 0"/><path d="M3 14v5a2 2 0 0 0 2 2h2v-7H3z"/><path d="M21 14v5a2 2 0 0 1-2 2h-2v-7h4z"/></svg><span class="menu-text">本地电台</span></a>
      </div>
    </div>
```

- [ ] **Step 2: 新增两个视图区**

在 `<main class="main">` 的 `<div class="main-inner">` 内，音源管理页 `</section>`（约 line 199）之后、设置页 `<section id="view-settings"` 之前插入：

```html
    <!-- 网络电台页 (radio5.cn) -->
    <section id="view-net-radio" class="view">
      <div id="net-radio-home">
        <div class="page-head">
          <h2 class="page-title">📻 网络电台</h2>
          <button id="net-radio-refresh">刷新</button>
          <div class="head-search">
            <input type="text" id="net-radio-keyword" placeholder="搜电台名（全站搜索）" class="name-in" />
            <button id="net-radio-search-btn">搜电台</button>
          </div>
        </div>
        <div class="pl-tabs" id="net-radio-quick-tabs">
          <span class="ptab active" data-path="fm/cmg">央媒</span>
          <span class="ptab" data-path="fm/province">省台</span>
          <span class="ptab" data-path="fm/hk">港澳台</span>
          <span class="ptab" data-path="fm/city">城市台</span>
          <span class="ptab" data-path="fm/市县台">市县台</span>
          <span class="ptab" data-advanced="1">⚙ 高级筛选</span>
        </div>
        <div id="net-radio-filter" class="filter-advanced" hidden>
          <div class="filter-row">
            <select id="filter-level"><option value="">级别(全部)</option></select>
            <select id="filter-area"><option value="">地区(全部)</option></select>
            <select id="filter-type"><option value="">类型(全部)</option></select>
            <select id="filter-language"><option value="">语言(全部)</option></select>
            <button id="filter-apply">应用筛选</button>
            <button id="filter-reset">重置</button>
          </div>
        </div>
        <div id="net-radio-status" class="status"></div>
        <div id="net-radio-grid" class="pl-grid"></div>
      </div>
      <!-- 搜索结果页 -->
      <div id="net-radio-search-page" hidden>
        <div class="page-head">
          <button id="net-radio-back" class="back-btn">← 返回分类</button>
          <h2 class="page-title">电台搜索结果</h2>
        </div>
        <div id="net-radio-search-status" class="status"></div>
        <div id="net-radio-search-grid" class="pl-grid"></div>
      </div>
    </section>

    <!-- 本地电台页 (Navidrome) -->
    <section id="view-local-radio" class="view">
      <div class="page-head">
        <h2 class="page-title">📻 本地电台</h2>
        <button id="local-radio-refresh">刷新</button>
      </div>
      <div class="toolbar"><span id="local-radio-summary"></span></div>
      <div id="local-radio-status" class="status"></div>
      <div id="local-radio-list"></div>
    </section>
```

- [ ] **Step 3: 引入 hls.js script**

在 `web/index.html` 底部，`<script src="/app.js"></script>`（约 line 316）之前插入：

```html
  <script src="/vendor/hls.min.js"></script>
```

- [ ] **Step 4: Commit**

```bash
git add web/index.html
git commit -m "feat(radio): add radio menu, views, and hls.js script"
```

---

## Task 8: 前端逻辑 — 视图 + 播放器 HLS 集成

**Files:**
- Modify: `web/app.js`（视图切换注册、网络电台逻辑、本地电台逻辑、播放器 radio 分支）

**Interfaces:**
- Consumes: `fetchJSON`、`escapeHtml`、`coverHtml`、`toast`、`startQueue`、`playCurrent` 的 item.kind 机制、`window.Hls`（Task 6）。
- Produces: `loadNetRadio()`、`loadLocalRadio()`、`playRadio(station, isHls)`、播放器 `kind:'radio'` 分支。

- [ ] **Step 1: 视图切换注册**

在 `web/app.js` 视图切换 hook（约 line 188，`if (name === 'search') loadSearchSquare()` 那段）内追加两行：

```js
    if (name === 'net-radio') loadNetRadio()
    if (name === 'local-radio') loadLocalRadio()
```

- [ ] **Step 2: 网络电台逻辑**

在 `web/app.js` 末尾（`initAuth()` 之前或之后均可，建议放曲库相关逻辑附近）追加：

```js
// ---------- 网络电台 (radio5.cn) ----------
let netRadioCatalog = null
let netRadioActivePath = 'fm/cmg'
let netRadioSearchActive = false

async function loadNetRadio() {
  // 切回分类首页
  $('#net-radio-home').hidden = false
  $('#net-radio-search-page').hidden = true
  netRadioSearchActive = false
  // 加载分类目录填充筛选下拉
  if (!netRadioCatalog) {
    try {
      netRadioCatalog = await fetchJSON('/api/v1/radio5/categories')
      fillFilterSelects(netRadioCatalog)
    } catch { /* 目录静态，失败也继续 */ }
  }
  // 默认加载第一个快捷标签（央媒）
  const activeTab = $('#net-radio-quick-tabs .ptab.active[data-path]') || $('#net-radio-quick-tabs .ptab[data-path]')
  if (activeTab) {
    netRadioActivePath = activeTab.dataset.path
    await loadNetRadioStations(netRadioActivePath)
  }
}

function fillFilterSelects(cat) {
  const fill = (sel, opts) => {
    const el = $(sel)
    if (!el) return
    opts.forEach((o) => { const opt = document.createElement('option'); opt.value = o.path; opt.textContent = o.label; el.appendChild(opt) })
  }
  fill('#filter-level', cat.level)
  fill('#filter-area', cat.area)
  fill('#filter-type', cat.type)
  fill('#filter-language', cat.language)
}

async function loadNetRadioStations(path) {
  netRadioActivePath = path
  netRadioSearchActive = false
  $('#net-radio-home').hidden = false
  $('#net-radio-search-page').hidden = true
  const grid = $('#net-radio-grid')
  const status = $('#net-radio-status')
  status.textContent = '加载中…'
  grid.innerHTML = ''
  try {
    const d = await fetchJSON(`/api/v1/radio5/stations?cat=${encodeURIComponent(path)}`)
    status.textContent = `共 ${d.total} 个电台`
    renderNetRadioGrid(grid, d.stations)
  } catch (err) {
    status.textContent = ''
    grid.innerHTML = `<div class="empty">加载失败：${escapeHtml(err.message)}</div>`
  }
}

function renderNetRadioGrid(grid, stations) {
  if (!stations.length) { grid.innerHTML = '<div class="empty">暂无电台</div>'; return }
  grid.innerHTML = stations.map((s) => `
    <div class="radio-card" data-slug="${escapeHtml(s.slug)}">
      <div class="radio-cover-wrap">${coverHtml(s.cover)}</div>
      <div class="radio-info">
        <div class="radio-name">${escapeHtml(s.name)}</div>
        <div class="radio-artist">${escapeHtml(s.artist || '网络电台')}</div>
      </div>
      <button class="radio-play-btn" data-slug="${escapeHtml(s.slug)}">▶ 播放</button>
    </div>`).join('')
  grid.querySelectorAll('.radio-card').forEach((card) => {
    card.addEventListener('click', () => playRadioStream(card.dataset.slug, card))
  })
}

// 快捷标签切换
$$('#net-radio-quick-tabs .ptab').forEach((t) => {
  t.addEventListener('click', () => {
    if (t.dataset.advanced) {
      // 高级筛选折叠切换
      $('#net-radio-filter').hidden = !$('#net-radio-filter').hidden
      return
    }
    $$('#net-radio-quick-tabs .ptab').forEach((x) => x.classList.toggle('active', x === t))
    loadNetRadioStations(t.dataset.path)
  })
})

// 高级筛选应用：四维任选，应用后取消快捷标签激活
$('#filter-apply')?.addEventListener('click', () => {
  const path = $('#filter-level').value || $('#filter-area').value || $('#filter-type').value || $('#filter-language').value
  if (!path) { toast('请至少选择一个筛选维度'); return }
  $$('#net-radio-quick-tabs .ptab').forEach((x) => x.classList.remove('active'))
  loadNetRadioStations(path)
})
$('#filter-reset')?.addEventListener('click', () => {
  ;['#filter-level', '#filter-area', '#filter-type', '#filter-language'].forEach((s) => { $(s).value = '' })
})

// 刷新
$('#net-radio-refresh')?.addEventListener('click', () => loadNetRadioStations(netRadioActivePath))

// 搜索
$('#net-radio-search-btn')?.addEventListener('click', () => {
  const q = $('#net-radio-keyword').value.trim()
  if (!q) return
  searchNetRadio(q)
})
$('#net-radio-keyword')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const q = $('#net-radio-keyword').value.trim(); if (q) searchNetRadio(q) }
})
$('#net-radio-back')?.addEventListener('click', () => loadNetRadioStations(netRadioActivePath))

async function searchNetRadio(q) {
  netRadioSearchActive = true
  $('#net-radio-home').hidden = true
  $('#net-radio-search-page').hidden = false
  const grid = $('#net-radio-search-grid')
  const status = $('#net-radio-search-status')
  status.textContent = '搜索中…'
  grid.innerHTML = ''
  try {
    const d = await fetchJSON(`/api/v1/radio5/search?q=${encodeURIComponent(q)}`)
    status.textContent = `找到 ${d.total} 个电台`
    renderNetRadioGrid(grid, d.stations)
  } catch (err) {
    status.textContent = ''
    grid.innerHTML = `<div class="empty">搜索失败：${escapeHtml(err.message)}</div>`
  }
}

// 点电台卡片 → 取流 → 播放（HLS）
async function playRadioStream(slug, cardEl) {
  document.querySelectorAll('.radio-card.playing').forEach((c) => c.classList.remove('playing'))
  if (cardEl) cardEl.classList.add('playing')
  let stream
  try {
    stream = await fetchJSON(`/api/v1/radio5/stream/${encodeURIComponent(slug)}`)
  } catch (err) {
    toast(`取流失败：${err.message}`)
    return
  }
  // 单元素队列播放，radio 类型走 HLS 分支
  startQueue([{
    kind: 'radio',
    slug,
    streamUrl: stream.streamUrl,
    label: stream.title || '网络电台',
    cover: stream.cover || '',
    artist: stream.artist || '',
    isHls: true,
  }], { cover: stream.cover || '', name: stream.title || '网络电台' })
}

// ---------- 本地电台 (Navidrome) ----------
async function loadLocalRadio() {
  const list = $('#local-radio-list')
  const status = $('#local-radio-status')
  const summary = $('#local-radio-summary')
  status.textContent = '加载中…'
  list.innerHTML = ''
  summary.textContent = ''
  try {
    const d = await fetchJSON('/api/v1/navidrome/radio')
    status.textContent = ''
    summary.textContent = `共 ${d.total} 个电台`
    renderLocalRadioList(list, d.stations)
  } catch (err) {
    status.textContent = ''
    summary.textContent = ''
    list.innerHTML = `<div class="empty">${escapeHtml(err.message)}。请在 Navidrome 后台 Settings > Radio 添加电台。</div>`
  }
}

function renderLocalRadioList(listEl, stations) {
  if (!stations.length) { listEl.innerHTML = '<div class="empty">未配置电台。请到 Navidrome 后台 > Settings > Radio 添加。</div>'; return }
  listEl.innerHTML = stations.map((s) => `
    <div class="radio-row" data-url="${escapeHtml(s.streamUrl)}" data-name="${escapeHtml(s.name)}">
      <div class="radio-row-info">
        <div class="radio-name">${escapeHtml(s.name)}</div>
        <div class="radio-stream">${escapeHtml(s.streamUrl)}</div>
      </div>
      <button class="radio-play-btn">▶ 播放</button>
    </div>`).join('')
  listEl.querySelectorAll('.radio-row').forEach((row) => {
    row.addEventListener('click', () => playLocalRadio(row.dataset.url, row.dataset.name, row))
  })
}

function playLocalRadio(url, name, rowEl) {
  document.querySelectorAll('.radio-row.playing').forEach((r) => r.classList.remove('playing'))
  if (rowEl) rowEl.classList.add('playing')
  // mp3 直链，原生 audio 播放，radio 类型非 HLS 分支
  startQueue([{
    kind: 'radio',
    streamUrl: url,
    label: name,
    cover: '',
    artist: '',
    isHls: false,
  }], { cover: '', name })
}

$('#local-radio-refresh')?.addEventListener('click', loadLocalRadio)
```

- [ ] **Step 3: 播放器新增 kind:'radio' 分支**

在 `web/app.js` 的 `playCurrent()` 函数内（约 line 977，`audio.dataset.proxyTried = ''` 之后、`if (item.kind === 'nav')` 之前），在 if-else 链中新增 radio 分支。将现有结构改为三分支。具体：在 `audio.dataset.proxyTried = ''` 之后插入 radio 分支判断，使其优先于 nav/net：

找到这段（约 line 977-985）：

```js
  renderQueuePanel() // 同步队列面板当前项高亮
  if (item.kind === 'nav') {
```

改为：

```js
  renderQueuePanel() // 同步队列面板当前项高亮
  if (item.kind === 'radio') {
    // 广播电台直播流：HLS(m3u8) 用 hls.js，mp3 直链用原生 audio
    audio.dataset.rid = `radio:${item.slug || item.streamUrl}`
    audio.dataset.proxyTried = 'done'
    setRadioLiveUI(true) // 直播流：进度条置灰
    if (item.isHls && window.Hls && Hls.isSupported()) {
      destroyHls()
      const hls = new Hls()
      window._radioHls = hls
      hls.loadSource(item.streamUrl)
      hls.attachMedia(audio)
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          // 致命错误：流失效(key过期等)，重取一次
          if (!audio.dataset.radioRetry && item.slug) {
            audio.dataset.radioRetry = '1'
            retryRadioStream(item.slug)
          } else {
            toast('电台流播放失败')
            stopPlayer()
          }
        }
      })
      audio.play().catch(() => toast('播放失败，可能流已失效'))
    } else {
      // 非 HLS 或 Safari 原生支持 m3u8 / mp3 直链
      audio.src = item.streamUrl
      audio.play().catch(() => toast('播放失败，可能流已失效'))
      audio.onerror = () => {
        if (!audio.dataset.radioRetry && item.slug) {
          audio.dataset.radioRetry = '1'
          retryRadioStream(item.slug)
        } else { toast('电台流播放失败'); stopPlayer() }
      }
    }
  } else if (item.kind === 'nav') {
```

并在文件合适位置（播放器工具函数区，`resetPlayerCover` 附近）追加辅助函数：

```js
// 广播电台直播流：销毁 hls 实例，避免流泄漏
function destroyHls() {
  if (window._radioHls) { try { window._radioHls.destroy() } catch { /* noop */ } window._radioHls = null }
}
// 直播流 UI：进度条置灰/恢复
function setRadioLiveUI(live) {
  const progress = $('#gp-progress')
  if (!progress) return
  progress.classList.toggle('disabled', !!live)
}
// 流失效重试：重新取流地址(key 过期) 再播
async function retryRadioStream(slug) {
  try {
    const s = await fetchJSON(`/api/v1/radio5/stream/${encodeURIComponent(slug)}`)
    const audio = $('#global-audio')
    destroyHls()
    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls()
      window._radioHls = hls
      hls.loadSource(s.streamUrl)
      hls.attachMedia(audio)
      audio.play().catch(() => {})
    } else {
      audio.src = s.streamUrl
      audio.play().catch(() => {})
    }
  } catch { toast('重试取流失败'); stopPlayer() }
}
```

同时在 `stopPlayer()` 函数内（约 line 1078，`audio.pause(); audio.src = ''` 之后）追加销毁 hls 与恢复 UI：

找到：

```js
function stopPlayer() {
  const audio = $('#global-audio')
  audio.pause(); audio.src = ''; audio.dataset.proxyTried = ''
```

改为在其后追加一行：

```js
function stopPlayer() {
  const audio = $('#global-audio')
  audio.pause(); audio.src = ''; audio.dataset.proxyTried = ''
  audio.dataset.radioRetry = ''
  destroyHls()
  setRadioLiveUI(false)
```

并在 `$('#gp-close')` 的点击处理（清空队列那行，约 line 1125）已调用 `stopPlayer()`，会自动覆盖。

- [ ] **Step 4: typecheck（前端无 TS，跳过）+ 启动实测**

```bash
cd server && CONFIG_PATH=../config.yaml npx tsx src/index.ts &
sleep 3
echo "前端可访问 http://localhost:23330/"
echo "手动验证：切到网络电台 → 央媒列表加载 → 点电台播放 → 听到 HLS 流"
echo "切高级筛选选类型音乐 → 应用 → 列表刷新"
echo "搜电台'音乐' → 结果列表 → 点播放"
echo "本地电台 → 2个电台 → 点播放(mp3)"
kill %1 2>/dev/null
```
Expected: 浏览器手动验证上述流程通过。

- [ ] **Step 5: Commit**

```bash
git add web/app.js
git commit -m "feat(radio): net/local radio views + HLS player integration"
```

---

## Task 9: 前端样式 — 电台卡片 + 筛选区 + 直播流态

**Files:**
- Modify: `web/style.css`

- [ ] **Step 1: 追加样式**

在 `web/style.css` 末尾追加：

```css
/* ---------- 广播电台 ---------- */
.radio-card {
  background: var(--card-bg, #fff);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  transition: box-shadow .15s, transform .15s;
  border: 1px solid var(--border, #eee);
}
.radio-card:hover { transform: translateY(-2px); box-shadow: 0 4px 14px rgba(0,0,0,.08); }
.radio-card.playing { border-color: var(--primary, #6b7cf6); box-shadow: 0 0 0 2px var(--primary, #6b7cf6); }
.radio-cover-wrap { width: 100%; aspect-ratio: 1/1; overflow: hidden; background: var(--bg-alt, #f5f5f5); }
.radio-cover-wrap .song-card-cover { width: 100%; height: 100%; object-fit: cover; }
.radio-cover-wrap .song-card-icon { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; }
.radio-info { padding: .6rem .7rem; flex: 1; }
.radio-name { font-weight: 600; font-size: .9rem; margin-bottom: .2rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.radio-artist { font-size: .75rem; color: var(--text-secondary, #888); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.radio-play-btn { margin: 0 .7rem .7rem; padding: .4rem; border: none; border-radius: 6px; background: var(--primary, #6b7cf6); color: #fff; cursor: pointer; font-size: .8rem; }

/* 高级筛选区 */
.filter-advanced { padding: .6rem 0; }
.filter-row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.filter-row select { padding: .35rem .5rem; border-radius: 6px; border: 1px solid var(--border, #ddd); background: var(--card-bg, #fff); color: inherit; }
.filter-row button { padding: .35rem .8rem; border-radius: 6px; border: none; cursor: pointer; }
#filter-apply { background: var(--primary, #6b7cf6); color: #fff; }
#filter-reset { background: var(--bg-alt, #eee); color: inherit; }

/* 本地电台列表行 */
.radio-row {
  display: flex; align-items: center; gap: .8rem;
  padding: .7rem .9rem; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--border, #eee); background: var(--card-bg, #fff);
  margin-bottom: .5rem; transition: box-shadow .15s;
}
.radio-row:hover { box-shadow: 0 2px 8px rgba(0,0,0,.06); }
.radio-row.playing { border-color: var(--primary, #6b7cf6); }
.radio-row-info { flex: 1; min-width: 0; }
.radio-stream { font-size: .72rem; color: var(--text-secondary, #999); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 直播流：进度条置灰 */
.gp-progress.disabled { opacity: .35; pointer-events: none; }
```

- [ ] **Step 2: 实测样式**

启动服务（同 Task 8 Step 4），浏览器验证电台卡片、筛选下拉、播放时进度条置灰样式正常。

- [ ] **Step 3: Commit**

```bash
git add web/style.css
git commit -m "feat(radio): radio card, filter, live-stream styles"
```

---

## Task 10: 最终验证与收尾

**Files:** 无（仅验证）

- [ ] **Step 1: 全量 typecheck**

```bash
cd server && npm run typecheck
```
Expected: 无错误。

- [ ] **Step 2: 启动服务端到端验证**

```bash
cd server && CONFIG_PATH=../config.yaml npx tsx src/index.ts
```
浏览器 http://localhost:23330/ 手动走查全部流程：
- 网络电台：5 快捷标签切换正常；高级筛选四维应用正常；搜索"音乐"返回结果；点央广电台听到 HLS 直播声；直播态进度条置灰。
- 本地电台：2 个电台加载；点击 mp3 流播放正常。
- 回归：切其他菜单（热榜歌曲/曲库歌曲）播放正常，无 hls 泄漏（切走电台后 hls 已销毁）。

- [ ] **Step 3: 关闭服务，确认无遗留**

确认所有改动已提交：`git status` 应 clean。

