# Ro API 文档

Ro 的完整 HTTP API 参考。所有接口以 `/api/v1` 为前缀，返回 `application/json`（SSE 除外）。

- **Base URL**：`http://<服务器IP>:23330`
- **数据格式**：请求体 `application/json`（文件上传为 `multipart/form-data`）
- **平台代号**：`kw`(酷我) `kg`(酷狗) `tx`(QQ音乐) `wy`(网易云) `mg`(咪咕)
- **音质代号**：`flac24bit` > `flac` > `320k` > `128k`

---

## 目录

- [鉴权](#鉴权)
- [1. 认证 Auth](#1-认证-auth)
- [2. 搜索 Search](#2-搜索-search)
- [3. 下载与任务 Download / Tasks](#3-下载与任务-download--tasks)
- [4. 音源管理 Sources](#4-音源管理-sources)
- [5. 设置 Settings](#5-设置-settings)
- [6. 实时事件 SSE](#6-实时事件-sse)
- [7. 状态 Status](#7-状态-status)
- [错误约定](#错误约定)
- [完整调用示例：搜索→下载→追踪](#完整调用示例搜索下载追踪)

---

## 鉴权

当 `config.yaml` 里 `auth.enabled: true` 时，除白名单外所有接口都需要鉴权。支持**两种方式**（任选其一）：

### 方式 A：Web 会话 Cookie（浏览器/前端）

先调 `POST /api/v1/auth/login`，响应会 `Set-Cookie: ro_sess=...`（HttpOnly，7 天）。后续请求带上该 Cookie 即可。

### 方式 B：API Key（脚本/程序调用，推荐）

在 Web 设置页生成 API Key（或调 `POST /api/v1/settings/apikey/generate`），然后在请求头带上，二选一：

```
X-API-Key: ro_xxxxxxxxxxxxxxxx
```
或
```
Authorization: Bearer ro_xxxxxxxxxxxxxxxx
```

**免鉴权白名单**（`auth.enabled=true` 时也放行）：`/login.html`、`/login.js`、`/style.css`、`/favicon.ico`、`POST /api/v1/auth/login`、`GET /api/v1/auth/status`。

**未授权行为**：`/api/*` 返回 `401 JSON`；其它路径 `302` 跳转 `/login.html`。

> `auth.enabled: false` 时全部放行，适合纯内网可信环境。

---

## 1. 认证 Auth

### POST /api/v1/auth/login

登录并获取会话 Cookie。

**请求体**：
```json
{ "username": "admin", "password": "admin" }
```

**响应 200**：`{ "ok": true }`（并 `Set-Cookie: ro_sess=...`）

**错误**：
- `400` `{ "error": "尚未设置登录密码..." }`（config 里未设密码）
- `401` `{ "error": "用户名或密码错误" }`

```bash
curl -c cookie.txt -X POST http://127.0.0.1:23330/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}'
```

### POST /api/v1/auth/logout

登出，清除会话 Cookie。响应 `{ "ok": true }`。

### GET /api/v1/auth/status

查询鉴权状态（**免鉴权**，用于前端判断是否需登录）。

**响应 200**：
```json
{ "enabled": true, "authenticated": false, "passwordConfigured": true }
```

---

## 2. 搜索 Search

> 所有搜索结果里的单曲对象（含 `songmid` / `name` / `singer` / `source` 等字段）可**原样**作为下载接口的 `musicInfo` 传入。

### GET /api/v1/search

单平台歌曲搜索。

**Query 参数**：

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `keyword` | 是 | — | 搜索关键词 |
| `platform` | 否 | `kw` | 平台代号 |
| `page` | 否 | `1` | 页码 |
| `limit` | 否 | 音源默认 | 每页条数 |

**错误**：`400` keyword 缺失 / platform 非法（返回 `valid` 平台列表）。

```bash
curl -b cookie.txt 'http://127.0.0.1:23330/api/v1/search?keyword=月亮之上&platform=kw&limit=5'
```

### GET /api/v1/search/aggregate

聚合搜索（多平台并发）。

**Query 参数**：`keyword`(必填)、`page`(默认1)、`limit`、`platforms`（逗号分隔，如 `kw,wy,mg`；省略=全平台）。

**响应**（结构示例）：
```json
{
  "keyword": "月亮之上",
  "page": 1,
  "results": [
    { "platform": "kw", "ok": true, "total": 30, "list": [ { "name": "月亮之上", "singer": "凤凰传奇", "source": "kw", "songmid": 107811, "albumName": "月亮之上", "interval": "4:31", "img": "...", "lrc": null } ] },
    { "platform": "kg", "ok": true, "total": 13, "list": [ ... ] }
  ]
}
```

```bash
curl -b cookie.txt 'http://127.0.0.1:23330/api/v1/search/aggregate?keyword=月亮之上&platforms=kw,wy,mg&limit=3'
```

### GET /api/v1/search/songlist

单平台**歌单**搜索。参数同 `/search`（`keyword` 必填、`platform`、`page`、`limit`）。

### GET /api/v1/search/songlist/aggregate

聚合歌单搜索。参数同 `/search/aggregate`。

### GET /api/v1/search/songlist/detail

获取歌单详情（含歌曲列表，可逐首或整单下载）。

**Query 参数**：`platform`(默认kw)、`id`(必填，歌单 ID)、`page`(默认1)。

```bash
curl -b cookie.txt 'http://127.0.0.1:23330/api/v1/search/songlist/detail?platform=kw&id=123456&page=1'
```

---

## 3. 下载与任务 Download / Tasks

### POST /api/v1/download

提交单首下载任务。

**请求体**：

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `platform` | 是 | — | 平台代号 |
| `musicInfo` | 是 | — | 搜索结果里的单曲对象，**必须含 `songmid` 和 `name`** |
| `quality` | 否 | `flac` | 目标音质（`flac24bit`/`flac`/`320k`/`128k`）|
| `primarySourceId` | 否 | — | 指定优先使用的音源 ID |
| `sourceIds` | 否 | — | 限定候选音源 ID 列表 |

**响应 201**：`{ "id": "<taskId>", "status": "pending" }`

**错误 400**：platform 非法 / musicInfo 缺 songmid|name / quality 非法。

```bash
curl -b cookie.txt -X POST http://127.0.0.1:23330/api/v1/download \
  -H 'Content-Type: application/json' \
  -d '{
    "platform": "kw",
    "quality": "flac",
    "musicInfo": { "name": "月亮之上", "singer": "凤凰传奇", "source": "kw", "songmid": 107811 }
  }'
```

### POST /api/v1/download/batch

批量下载（一次最多 **200** 首）。

**请求体**：
```json
{
  "quality": "flac",
  "primarySourceId": "real-source",
  "items": [
    { "platform": "kw", "musicInfo": { "name": "...", "songmid": 1, "singer": "...", "source": "kw" }, "quality": "320k" },
    { "platform": "wy", "musicInfo": { "name": "...", "songmid": 2, "singer": "...", "source": "wy" } }
  ]
}
```
每个 item 的 `quality` 可覆盖顶层默认。

**响应 201**：
```json
{ "acceptedCount": 2, "rejectedCount": 0,
  "accepted": [ { "index": 0, "id": "...", "name": "..." } ],
  "rejected": [] }
```

### GET /api/v1/tasks

任务列表。可选 `?status=` 过滤（`pending`/`active`/`completed`/`completed_with_warnings`/`failed`/`canceled`）。

**响应**：`{ "tasks": [ ... ] }`

### GET /api/v1/tasks/:id

单任务详情。

**响应 200**（示例）：
```json
{
  "id": "1662fe1d-...",
  "status": "completed",
  "name": "月亮之上",
  "singer": "凤凰传奇",
  "actualSource": "real-source",
  "progress": 100,
  "filePath": "/app/data/downloads/月亮之上 - 凤凰传奇.flac",
  "error": null
}
```
换源成功时 `status` 可能为 `completed_with_warnings`，`actualSource` 记为实际命中音源。

**错误 404**：`{ "error": "task not found" }`

### POST /api/v1/tasks/:id/retry

重试失败任务。成功 `{ "id": "...", "status": "pending" }`；不可重试 `409`。

### POST /api/v1/tasks/:id/cancel

取消任务。成功 `{ "id": "...", "status": "canceled" }`；不可取消 `409`。

### DELETE /api/v1/tasks/:id

删除任务记录。成功 `{ "id": "...", "deleted": true }`；不存在 `404`。

---

## 4. 音源管理 Sources

### GET /api/v1/sources

音源列表（含状态/平台/音质）。

**响应**：
```json
{ "sources": [ {
  "id": "real-source", "name": "[独家音源]", "description": "...",
  "version": "4", "author": "...", "homepage": "",
  "status": "ready", "enabled": true, "errorMessage": null,
  "platforms": [ { "platform": "kw", "actions": ["musicUrl"], "qualitys": ["128k","320k","flac","flac24bit"] } ]
} ] }
```

### POST /api/v1/sources/import/content

粘贴脚本内容导入。请求体 `{ "name": "可选", "content": "<音源脚本源码>" }`。成功 `201` 返回音源视图；`content` 缺失 `400`。

### POST /api/v1/sources/import/url

在线 URL 导入。请求体 `{ "url": "https://...", "name": "可选" }`。成功 `201`；`url` 缺失 `400`。

### POST /api/v1/sources/upload

文件上传（`multipart/form-data`，字段为文件）。成功 `201`。

```bash
curl -b cookie.txt -X POST http://127.0.0.1:23330/api/v1/sources/upload \
  -F 'file=@real-source.js'
```

### PATCH /api/v1/sources/:id/enabled

启停音源。请求体 `{ "enabled": true|false }`。成功 `{ "id": "...", "enabled": true }`；缺字段 `400`；不存在 `404`。

### POST /api/v1/sources/:id/reload

热重载单个音源。成功返回音源视图；不存在 `404`。

### DELETE /api/v1/sources/:id

删除音源。成功 `{ "id": "...", "deleted": true }`；不存在 `404`。

---

## 5. 设置 Settings

> **安全**：`apiKey` 与 `webLogin.password` 永不回传明文，只回传是否已设置（布尔）。空字符串的密钥字段视为「不修改」。

### GET /api/v1/settings

返回脱敏配置视图。

```json
{
  "auth": { "apiKeySet": true },
  "download": { "concurrency": 3, "defaultQuality": "flac", "nameTemplate": "{name} - {singer}", "embedCover": true, "embedLyric": true, "coverSize": 500 },
  "smokeTest": { "enabled": true, "cron": "0 6 * * *", "keyword": "周杰伦", "checkLyric": true, "checkPic": true, "alertThreshold": 2,
    "alert": { "bark": { "enabled": false, "serverUrl": "https://api.day.app", "deviceKeySet": false }, "serverChan": { "enabled": false, "sendKeySet": false } } }
}
```

### PATCH /api/v1/settings

局部更新配置（下载 / 冒烟测试 / 告警）。只传要改的字段。

**校验规则**：
- `download.concurrency`：1–10 整数
- `download.defaultQuality`：须为四种音质之一
- `download.coverSize`：100–1000 整数

```bash
curl -b cookie.txt -X PATCH http://127.0.0.1:23330/api/v1/settings \
  -H 'Content-Type: application/json' \
  -d '{ "download": { "concurrency": 5, "defaultQuality": "320k" } }'
```
并发变化即时生效；`smokeTest.cron`/`enabled` 变化会重排定时任务。响应返回更新后的脱敏视图。

### POST /api/v1/settings/apikey/generate

生成新的 API Key（`ro_` + 32 字节 base64url）。**明文仅在本次响应返回一次**，之后只能看到 `apiKeySet=true`。

**响应**：`{ "apiKey": "ro_xxxx...", "once": true }`

> 生成即覆盖旧 Key。请立即保存。

### DELETE /api/v1/settings/apikey

撤销当前 API Key。响应 `{ "ok": true, "apiKeySet": false }`。

### POST /api/v1/settings/notify/test

发送测试告警（Bark / Server酱，按 config 配置的渠道）。请求体可选 `{ "title": "...", "body": "..." }`。响应 `{ "results": [...] }`。

---

## 6. 实时事件 SSE

### GET /api/v1/sse/subscribe

Server-Sent Events 事件流。`Content-Type: text/event-stream`，服务端每 15s 发送 `: ping` 心跳注释行防断连。

**首包**：`event: connected` + `data: { "ts": <毫秒> }`

**事件类型**：

| 事件 | 触发 |
|---|---|
| `task:created` | 任务创建 |
| `task:active` | 任务开始下载 |
| `task:progress` | 下载进度更新 |
| `task:completed` | 下载完成 |
| `task:completed_with_warnings` | 完成（触发过换源等警告）|
| `task:failed` | 下载失败 |
| `task:canceled` | 任务取消 |
| `source:changed` | 音源目录变更/重载 |
| `source:update-alert` | 音源更新提醒 |
| `smoke:completed` | 冒烟测试完成 |
| `smoke:failed` | 冒烟测试失败 |

每条事件格式：`event: <name>\ndata: <json>\n\n`。

> **断线重连**后应调一次 `GET /api/v1/tasks` 做全量对账，避免漏事件。

```javascript
const es = new EventSource('http://127.0.0.1:23330/api/v1/sse/subscribe', { withCredentials: true })
es.addEventListener('task:progress', e => console.log('进度', JSON.parse(e.data)))
es.addEventListener('task:completed', e => console.log('完成', JSON.parse(e.data)))
```
> 注意：原生 `EventSource` 不支持自定义请求头，API Key 场景建议用会话 Cookie，或改用支持 header 的 SSE 客户端（如 `fetch` 流式读取）。

---

## 7. 状态 Status

### GET /api/v1/status

服务健康与运行指标（也是容器 healthcheck 探测的端点）。

**响应 200**：
```json
{
  "app": "ro", "version": "0.1.0", "uptimeSec": 3600,
  "node": "v22.x.x", "memoryMB": 198,
  "sources": { "loaded": 1, "ready": 1 },
  "tasks": { "pending": 0, "active": 1, "completed": 12, "failed": 0 }
}
```
> 开启鉴权时未授权访问返回 `401`（healthcheck 视 401 为「存活」，仅连接失败判宕机）。

---

## 错误约定

所有错误响应统一为 JSON：`{ "error": "<描述>" }`，部分附带 `valid` 字段列出合法取值。

| 状态码 | 含义 |
|---|---|
| `400` | 参数缺失或非法 |
| `401` | 未授权（未登录 / API Key 无效）|
| `404` | 资源不存在（任务/音源）|
| `409` | 状态冲突（任务不可重试/取消）|
| `201` | 创建成功（下载任务/音源导入）|

---

## 完整调用示例：搜索→下载→追踪

以 API Key 方式，下载「月亮之上」并轮询任务状态：

```bash
BASE=http://127.0.0.1:23330
KEY='ro_你的APIKey'
H="-H X-API-Key:$KEY"

# 1. 聚合搜索，取 kw 第一条
curl -s $H "$BASE/api/v1/search/aggregate?keyword=月亮之上&platforms=kw&limit=1" -o search.json

# 2. 提交下载（把搜索结果里的单曲对象整体作为 musicInfo）
curl -s $H -X POST $BASE/api/v1/download \
  -H 'Content-Type: application/json' \
  -d '{"platform":"kw","quality":"flac","musicInfo":{"name":"月亮之上","singer":"凤凰传奇","source":"kw","songmid":107811}}'
# → { "id": "abc-123", "status": "pending" }

# 3. 轮询任务状态
curl -s $H $BASE/api/v1/tasks/abc-123
# → { "status": "completed", "filePath": "/app/data/downloads/月亮之上 - 凤凰传奇.flac", ... }
```

下载完成的文件落在容器 `/app/data/downloads`（本项目部署映射到宿主机下载目录），歌词与封面已内嵌进音频文件。
