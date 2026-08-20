# 广播电台功能设计 (Radio Stations)

- **日期**: 2026-08-20
- **项目**: MusicHub (ai-playlist)
- **分类**: 架构级（新子系统，新增菜单 + 两个独立数据源 + 新播放方式）

## 1. 背景与目标

为 MusicHub 新增「广播电台」一级菜单，下含两个二级子菜单：

- **网络电台**：数据源 `radio5.cn`，提供分类筛选 + 全站搜索，点击播放。
- **本地电台**：数据源 Navidrome 的 `getInternetRadioStations`，直链播放。

两个数据源独立，但都接入现有全局播放器 `<audio>`。网络电台引入 HLS 直播流播放（项目首次使用 hls.js）。

## 2. 调研结论（已验证可行性）

### 2.1 网络电台 (radio5.cn)

| 关键点 | 结论 |
|---|---|
| 电台列表获取 | 分类页（如 `/fm/cmg`）服务端渲染 HTML，每个电台条目同时带数字 post id（`post-1246`）、slug（`/play/radio/cnr-zgzs`）、名称、封面，一次抓取全拿到。 |
| 真实流地址 | REST API `GET https://radio5.cn/api/play/play/{数字post_id}`，**无需 nonce**，仅需 `Referer: https://radio5.cn/` 头。返回 `stream_url` 字段。 |
| 流格式 | HLS (m3u8) media playlist，含 `.ts` 分片，直播流。央广走 `ytcast2.radio.cn` 中继。 |
| 流鉴权 | `key` 时效鉴权（每次调用 API 返回新 key，旧 key 会过期）。 |
| 跨域播放 | m3u8 与 .ts 分片均返回 `Access-Control-Allow-Origin: *`，浏览器可用 hls.js 直接播，无需服务端转码代理。 |
| 搜索 | `GET /api/play/search?s={关键词}`，返回 `[{title, url(含slug), thumbnail}]`。 |
| slug→id 解析 | 抓 `/play/radio/{slug}` 播放页 HTML，body class 含 `postid-XXXX`。post id 稳定可长期缓存。 |

### 2.2 分类体系

radio5 有两套分类（来源 `/fm/radio-type` 总枢纽页，已抓全）：

- **快捷标签**（5 个，对应 `/fm/` 路径）：
  - 央媒 `/fm/cmg`、省台 `/fm/province`、港澳台 `/fm/hk`、热门城市台 `/fm/city`、市县台 `/fm/市县台`
- **四维筛选**（来源 `/level/`、`/area/`、`/radio/`、`/language/`）：
  - 电台级别：国家级 `/level/g`、省台 `/level/s`、市县台 `/level/x`、港澳台 `/level/hk`、热门城市台 `/level/c`、网络台 `/level/net`
  - 地区：中央 `/area/cn`、北京 `/area/bj`、上海 `/area/sh`、广东 `/area/gd` … 共 35 项（各省/直辖市/港澳台）
  - 电台类型：音乐 `/radio/music`、新闻综合 `/radio/news`、交通 `/radio/traffic`、生活 `/radio/life`、财经 `/radio/financial`、文艺|曲艺 `/radio/art`、都市 `/radio/city`、文体旅游 `/radio/cst`、乡村 `/radio/village`、青少科教 `/radio/youth`
  - 主播语言：汉·普通话 `/language/cn`、汉·粤语 `/language/hk`、汉·方言|民族语 `/language/my`、English `/language/en`、… 共 15 项

### 2.3 本地电台 (Navidrome)

- Subsonic API `getInternetRadioStations` 已实测可用，返回现有 2 个电台（山西故事广播、扬州江都区电台FM100.7）。
- `streamUrl` 是直链 mp3，浏览器 `<audio>` 原生可播，不含凭据可前端直连。

## 3. 总体架构

### 3.1 菜单结构

侧边栏新增一级菜单组「广播电台」（`data-group="radio"`），复用现有 `menu-group` 折叠模式：

```
广播电台 (radio)
├── 网络电台 (data-tab="net-radio")   ← radio5.cn
└── 本地电台 (data-tab="local-radio") ← Navidrome
```

### 3.2 组件划分

后端新增独立模块 `server/src/core/radio5/`，扩展 `navidrome/client.ts`，新增 `routes/radio.ts`。前端新增两个视图 + hls.js 集成。

所有单元职责单一、接口清晰，可独立测试（typecheck + 启动自测，项目无测试框架）。

## 4. 后端设计

### 4.1 新模块 `server/src/core/radio5/client.ts`

radio5 抓取/API 客户端，所有请求带 `Referer: https://radio5.cn/` 与浏览器 UA，用 needle。

```ts
export interface RadioStation {
  id: string          // 数字 post id（如 "1246"）
  slug: string        // URL slug（如 "cnr-zgzs"）
  name: string        // 电台名（如 "中央台中国之声"）
  cover: string       // 封面完整 URL（补全 https://radio5.cn）
  artist?: string     // 机构（如 "CNR中央人民广播电台"，能解析到则填）
}

export interface RadioStream {
  streamUrl: string   // m3u8 直播流地址（带时效 key）
  title: string
  cover: string
  artist: string
  isHls: true
}
```

| 方法 | 作用 | 实现细节 |
|---|---|---|
| `getStationsByCategory(path)` | 按分类路径取电台列表 | fetch `https://radio5.cn/{path}`，正则解析每个 `post-(\d+)` 与其同容器内的 `data-url=".../play/radio/{slug}"`、`<img>` 封面 src、标题文本。path 例：`fm/cmg`、`area/zj`、`radio/music`、`level/g`、`language/en`。 |
| `searchStations(q)` | 全站搜索 | `GET /api/play/search?s={encodeURIComponent(q)}`，解析 JSON，从每项 `url` 提取 slug，`thumbnail` 提取封面。返回 `RadioStation[]`（id 为空，搜索结果无数字 id）。 |
| `getStream(slug)` | 取播放流 | slug→id：先查内存缓存（post id 稳定，长缓存）；未命中则 fetch `/play/radio/{slug}` 取 body class 里 `postid-(\d+)`，回填缓存。再用 `GET /api/play/play/{id}` 取 `stream_url`、`title`、`artwork_url`、`artist`，返回 `RadioStream`。 |

**缓存策略**：
- 分类电台列表：内存缓存，TTL 10 分钟（`{path: {list, ts}`）。
- slug→id 映射：内存长缓存（post id 稳定，不设过期，仅随进程生命周期）。
- 流地址：**不缓存**（key 时效，每次调用取新 key）。

### 4.2 新模块 `server/src/core/radio5/catalog.ts`

静态分类目录（稳定数据，硬编码，不每次抓 `/fm/radio-type`）：

```ts
export interface CategoryOption { label: string; path: string }
export interface Catalog {
  quick: CategoryOption[]          // 5 个快捷标签
  level: CategoryOption[]          // 6 项
  area: CategoryOption[]           // 35 项
  type: CategoryOption[]           // 10 项
  language: CategoryOption[]       // 15 项
}
export const radioCatalog: Catalog
```

> 注：`市县台` 快捷标签 path 为 `/fm/市县台`（中文，需 encodeURIComponent 编码，由路由层处理）。

### 4.3 扩展 `server/src/core/navidrome/client.ts`

新增方法：

```ts
async getInternetRadioStations(): Promise<{
  id: string; name: string; streamUrl: string; homepageUrl?: string
}[]> {
  // 调 get('getInternetRadioStations')，解析 internetRadioStations.internetRadioStation[]
}
```

### 4.4 新路由 `server/src/routes/radio.ts`

注册到 `index.ts`（在 navidromeRoutes 之后、静态资源之前）。

| 接口 | 方法 | 作用 |
|---|---|---|
| `/api/v1/radio5/categories` | GET | 返回分类目录（快捷标签 + 四维），纯静态 |
| `/api/v1/radio5/stations?cat={path}` | GET | 抓取某分类电台列表（cat 已 encodeURIComponent 编码） |
| `/api/v1/radio5/search?q={keyword}` | GET | 全站搜索电台 |
| `/api/v1/radio5/stream/:slug` | GET | 解析 slug→id→streamUrl，返回播放流地址（含时效 key） |
| `/api/v1/navidrome/radio` | GET | Navidrome 网络电台列表（直链 mp3） |

- `stream/:slug` 返回 `{streamUrl, title, cover, artist, isHls}`，流地址时效 key 由服务端现取，前端拿到即播。
- Navidrome 电台 streamUrl 不含凭据，前端直连播放。

> radio5 路由复用现有应用层限流（已全局 hook 在 `/api/*`）。

### 4.5 路由注册

`server/src/index.ts` 增加：
```ts
import { radioRoutes } from './routes/radio.js'
// ...
await app.register(radioRoutes)
```

## 5. 前端设计

### 5.1 `web/index.html`

- 侧边栏在「本地曲库」分组后新增 `data-group="radio"` 菜单组 + 两个 `menu-item`。
- `<main>` 内新增两个视图区：`#view-net-radio`、`#view-local-radio`。
- 引入 hls.js：`web/vendor/hls.min.js`（本地化，~120KB，无 CDN 依赖，适配 Docker 自托管），`<script src="/vendor/hls.min.js"></script>` 加在 `app.js` 之前。

### 5.2 网络电台视图 `#view-net-radio`

布局：
```
[🎵 网络电台]  [搜索框: 搜电台名] [搜索]  [刷新]
快捷标签: 央媒 | 省台 | 港澳台 | 城市台 | 市县台 | ⚙高级筛选
高级筛选(默认折叠):
  [级别 ▾] [地区 ▾] [类型 ▾] [语言 ▾]  [应用筛选] [重置]
电台网格: 封面 + 名称 + 机构 + (播放次数，有则显示)  → 点击播放
```

交互：
- 进页 → 拉 `/radio5/categories` + 默认央徽列表（`/radio5/stations?cat=fm/cmg`）→ 渲染。
- 快捷标签与高级筛选互斥：点快捷标签清空高级筛选四项；点「应用筛选」取消快捷标签激活态。
- 搜索独立：搜索时隐藏分类网格、显示搜索结果；点击「搜索」按钮触发，清空搜索框并点搜索（或提供返回按钮）回到当前分类视图。搜索结果电台同样走 `/radio5/stream/:slug` 播放（`getStream` 内部 slug→id 解析，故搜索结果 id 为空不影响播放）。
- 刷新按钮：清当前分类缓存重新拉取。

### 5.3 本地电台视图 `#view-local-radio`

布局：
```
[📻 本地电台]  [刷新]
电台列表: 名称 + 流地址(截断)  → 点击播放
(无电台时) 空态: 提示"未配置电台，请到 Navidrome 后台 > Settings > Radio 添加"
```

进页 → `/navidrome/radio` → 渲染。Navidrome 未连接时显示连接失败空态。

### 5.4 播放器集成（`web/app.js`）

现有 `playCurrent()` 按 `item.kind` 分流（`nav` / 网络音源）。新增 `kind: 'radio'` 分支：

- **HLS 流**（radio5，`item.hls === true`）：
  ```js
  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls()
    hls.loadSource(item.streamUrl)
    hls.attachMedia(audio)
    audio.play()
  } else {
    audio.src = item.streamUrl  // Safari 原生支持 m3u8
    audio.play()
  }
  ```
  切歌/停播时销毁 hls 实例（`hls.destroy()`），避免流泄漏。
- **mp3 流**（Navidrome 电台）：`audio.src = item.streamUrl`，同现有 nav 路径。

**直播流交互**：
- 电台以单元素队列播放，禁用上/下一首按钮（或点击无响应）。
- 进度条置灰（直播流无 duration/seek）。
- 流错误（key 过期 / 网络中断）→ 重新调 `/radio5/stream/:slug` 取新流重试一次；仍失败 toast 提示。

**菜单切换注册**：视图切换 hook 增加：
```js
if (name === 'net-radio') loadNetRadio()
if (name === 'local-radio') loadLocalRadio()
```

### 5.5 样式 `web/style.css`

- 电台卡片复用现有 `.pl-grid` / `.song-card` 样式族，新增 `.radio-card`（封面 + 名称 + 机构副标题）。
- 高级筛选折叠区复用 `.menu-group` 折叠样式思路，新增 `.filter-advanced`。
- 直播流态：全局播放器进度条 `.gp-progress` 加 `.disabled` 置灰态。

## 6. 数据流

### 6.1 网络电台
1. 进网络电台 → `/radio5/categories` + `/radio5/stations?cat=fm/cmg` → 渲染网格。
2. 切快捷标签 → `/radio5/stations?cat={path}` → 重新渲染。
3. 高级筛选应用 → `/radio5/stations?cat={path}`（path 为所选维度项的 path）→ 渲染。
4. 搜索 → `/radio5/search?q={kw}` → 渲染搜索结果。
5. 点电台 → `/radio5/stream/:slug` → streamUrl → hls.js 播放。

### 6.2 本地电台
1. 进本地电台 → `/navidrome/radio` → 渲染列表。
2. 点电台 → streamUrl（mp3 直链）→ 原生 `<audio>` 播放。

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| radio5 分类抓取失败 | 空态 + toast「加载电台失败」 |
| radio5 搜索无结果 | 空态「未找到相关电台」 |
| radio5 取流失败（slug 解析失败） | toast「解析电台失败」 |
| 流播放失败（key 过期） | 静默重调 `/stream/:slug` 取新流重试一次；仍失败 toast |
| Navidrome 未连接 | 空态「Navidrome 连接失败」 |
| Navidrome 无电台 | 空态提示去后台添加 |
| 浏览器不支持 HLS | toast「请使用 Chrome/Safari/Edge 等现代浏览器」 |

## 8. 文件清单

**新增**：
- `server/src/core/radio5/client.ts` —— radio5 抓取/API 客户端
- `server/src/core/radio5/catalog.ts` —— 静态分类目录
- `server/src/routes/radio.ts` —— 广播电台路由
- `web/vendor/hls.min.js` —— HLS 播放库（本地化）

**修改**：
- `server/src/core/navidrome/client.ts` —— 新增 `getInternetRadioStations`
- `server/src/index.ts` —— 注册 radioRoutes
- `web/index.html` —— 菜单组 + 两个视图 + hls.js 引入
- `web/app.js` —— 两个视图逻辑 + 播放器 HLS 分支
- `web/style.css` —— 电台卡片 + 筛选区 + 直播流态样式

## 9. 验证方式

项目无测试框架，采用：
- `npm run typecheck`（server）确保类型正确。
- 启动服务实测：
  - 网络电台：5 快捷标签切换、四维筛选、搜索、点击播放央广 HLS 流。
  - 本地电台：列表加载、点击播放 mp3 直链。
  - 直播流：进度条置灰、错误重试。

## 10. 不在本次范围

- 网络电台收藏功能（用户未要求，YAGNI）。
- 本地电台的增删改（Navidrome 后台管理，非本工具职责）。
- 电台录音/回放（直播流无此能力）。
- 服务端 HLS 转码代理（已确认流可跨域直连，无需）。
