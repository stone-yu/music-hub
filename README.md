# Ro — 无头音乐下载服务

> Headless music download service，基于 [lx-music](https://github.com/lyswhut/lx-music-desktop) 音源生态。
> 纯个人自用 / 局域网部署定位：搜索、下载（含歌词+封面嵌入）、歌单、跨平台换源兜底、健康冒烟测试，全部通过一个轻量 Web 后台 + REST API 操作。

---

## 目录

- [特性](#特性)
- [完整 API 文档](./API.md)
- [架构与技术选型](#架构与技术选型)
- [部署方式](#部署方式)
  - [方式一：Docker 镜像（最简单，推荐）](#方式一docker-镜像最简单推荐)
  - [方式二：Docker Compose 从源码构建](#方式二docker-compose-从源码构建)
  - [方式三：本地部署（Node.js）](#方式三本地部署nodejs)
- [配置说明（config.yaml）](#配置说明configyaml)
- [音源管理](#音源管理)
- [跨平台换源机制](#跨平台换源机制)
- [REST API 文档](#rest-api-文档)
- [SSE 实时事件](#sse-实时事件)
- [鉴权与 API Key](#鉴权与-api-key)
- [健康冒烟测试](#健康冒烟测试)
- [内存占用](#内存占用)
- [Docker 镜像说明](#docker-镜像说明)
- [外部控制：局域网 vs 公网](#外部控制局域网-vs-公网)
- [常见问题 / 排错](#常见问题--排错)

---

## 特性

- **5 平台**：kw(酷我) / kg(酷狗) / tx(QQ音乐) / wy(网易云) / mg(咪咕)
- **四维度搜索**：歌曲名 / 歌手 / 专辑 / 歌单；支持单平台与聚合(全平台)
- **下载全链路**：流式下载 + 元数据/歌词/封面嵌入（FLAC / MP3），SQLite 记录任务
- **跨平台换源兜底**：主平台音质降级链全失败 → `findMusic` 跨平台匹配同款 → 逐候选平台重试
- **歌单**：本地歌单管理 + 整单批量下载
- **音源管理**：本地文件上传 + 在线 URL 导入 + 热重载
- **实时进度**：SSE 推送任务状态
- **健康冒烟测试**：定时跑真实下载链路，平台×音源矩阵 + Bark/Server酱 告警
- **轻量鉴权**：Web 登录（内存 session）+ API Key 双通道
- **低内存**：SQLite + p-queue 取代 Redis/BullMQ，实测 RSS ≈ 198MB

---

## 架构与技术选型

```
ro/
├── server/                # Fastify + TypeScript 后端
│   └── src/
│       ├── index.ts        # 入口：装配鉴权守卫、限流、路由、静态资源
│       ├── core/
│       │   ├── source-engine/   # 音源引擎（双层沙箱、热重载、音质降级链）
│       │   ├── adapters/        # 5 平台适配器（musicSearch/songList/lyric/pic）
│       │   ├── search/          # 搜索服务（单平台 + aggregate）
│       │   ├── download/        # 下载队列（p-queue）
│       │   ├── orchestrator/    # 取 URL 两段式编排 + 换源兜底
│       │   ├── db/              # better-sqlite3（任务/歌单/冒烟）
│       │   ├── notify/          # Bark + Server酱 告警
│       │   ├── smoke/           # 冒烟测试 + scheduler
│       │   ├── auth/            # session + API Key 校验
│       │   ├── rate-limit.ts    # 内存固定窗口限流
│       │   ├── config.ts        # config.yaml 加载 + 运行时 patch
│       │   └── events.ts        # 事件总线（供 SSE）
│       └── routes/         # REST 路由
├── web/                   # 原生 HTML/CSS/JS 后台（6 页）
├── data/                  # 运行数据（volume 映射宿主机）
│   ├── downloads/          # 下载的音乐文件
│   ├── sources/            # lx-music 音源脚本(.js)
│   └── db/                 # SQLite（ro.db + -wal/-shm）
├── config.yaml            # 配置（volume 映射，改完重启容器生效）
├── Dockerfile             # 多阶段构建
└── compose.yaml           # Docker Compose 编排
```

**关键技术决策：**

| 决策 | 说明 |
|---|---|
| **沙箱选 `node:vm` + worker_threads** | 替代方案 `isolated-vm` 需要本地 C++ 编译（node-gyp），部署环境**无 g++**，故用 node 内置 vm 双层隔离；隔离水位对个人自用等价。 |
| **SQLite + p-queue** 取代 Redis/BullMQ | 单进程自用不需要外部依赖，内存目标 <300MB。 |
| **session 存内存** | 重启即失效（重新登录即可），局域网自用足够，避免持久化 token 的复杂度。 |
| **鉴权守卫装根 app** | `registerAuthGuard(app)` 必须在根实例上 `addHook('onRequest')`；若通过 `app.register()` 注册会被 Fastify 封装、只作用于插件内路由。 |
| **原生模块容器内编译** | `better-sqlite3` / `sharp` 在 `node:22-bookworm`(builder 阶段，含工具链)内编译，运行阶段用 `node:22-bookworm-slim`；宿主机无需 g++。 |

---

## 部署方式

提供三种部署方式，按从简到繁排列。**推荐方式一**（直接拉预构建镜像，无需本地编译）。

所有方式启动后都访问 `http://<服务器IP>:23330/`，用 `config.yaml` 里的用户名/密码登录。

> **通用前置**：至少准备一个 lx-music 音源脚本（`.js`），放进 `data/sources/`（或启动后在 Web 音源页导入）。

---

### 方式一：Docker 镜像（最简单，推荐）

直接从 Docker Hub 拉取预构建的多架构镜像（`linux/amd64` + `linux/arm64`），无需本地构建工具链。

**镜像地址**：[`a914599611/ro-music`](https://hub.docker.com/r/a914599611/ro-music)

```bash
# 1. 准备目录与配置
mkdir -p ro/data/downloads ro/data/sources ro/data/db && cd ro
# 下载配置模板（或手写 config.yaml，见配置说明）
curl -fsSL https://raw.githubusercontent.com/leizi914599611-boop/ro/main/config.example.yaml -o config.yaml
# 编辑 config.yaml，至少设一个登录密码（auth.webLogin.password）

# 2. 拉取并运行（Docker 会自动匹配当前 CPU 架构）
docker run -d --name ro \
  --restart unless-stopped \
  -p 23330:23330 \
  -e TZ=Asia/Shanghai \
  -v "$PWD/config.yaml:/app/config.yaml" \
  -v "$PWD/data/downloads:/app/data/downloads" \
  -v "$PWD/data/sources:/app/data/sources" \
  -v "$PWD/data/db:/app/data/db" \
  --memory 512m \
  a914599611/ro-music:latest

# 3. 查看状态
docker ps                   # STATUS 应为 Up (healthy)
docker logs -f ro           # 看启动日志
```

**或用 Compose 拉镜像**（把 compose.yaml 里 `build:` 段换成 `image:`）：

```yaml
services:
  ro:
    image: a914599611/ro-music:latest   # 不再本地构建，直接拉镜像
    container_name: ro
    restart: unless-stopped
    ports:
      - "23330:23330"
    environment:
      TZ: Asia/Shanghai
    volumes:
      - ./config.yaml:/app/config.yaml
      - ./data/downloads:/app/data/downloads
      - ./data/sources:/app/data/sources
      - ./data/db:/app/data/db
    mem_limit: 512m
```

```bash
docker compose up -d
```

**升级到新版本**：
```bash
docker pull a914599611/ro-music:latest
docker compose up -d          # 或 docker rm -f ro 后重跑 docker run
```

---

### 方式二：Docker Compose 从源码构建

想自己改代码、或不信任预构建镜像时，用仓库自带的 Dockerfile 本地构建（多阶段构建，原生模块在容器内编译，宿主机无需 g++）。

```bash
# 1. 克隆仓库
git clone https://github.com/leizi914599611-boop/ro.git && cd ro

# 2. 准备配置
cp config.example.yaml config.yaml
# 编辑 config.yaml，至少设一个登录密码

# 3. 构建并启动
docker compose build
docker compose up -d

# 4. 查看状态
docker compose ps           # 应为 Up (healthy)
docker logs -f ro
```

**改代码后重建**：
```bash
docker compose build && docker compose up -d
```

---

### 方式三：本地部署（Node.js）

不想用 Docker、直接在宿主机跑。**注意**：`better-sqlite3` / `sharp` 是原生模块，`npm install` 时会本地编译，需要构建工具链（Debian/Ubuntu：`apt install -y build-essential python3`）。

```bash
# 前置：Node.js >= 20（推荐 22）

# 1. 克隆并进入 server
git clone https://github.com/leizi914599611-boop/ro.git && cd ro
cp config.example.yaml config.yaml
# 编辑 config.yaml，至少设一个登录密码

cd server

# 2. 装依赖（会本地编译原生模块；国内可用镜像加速）
npm config set registry https://registry.npmmirror.com
npm install

# 3. 编译 TypeScript
npm run build

# 4. 启动（在项目根目录读 config.yaml）
npm start                   # = node dist/index.js
```

**开发模式**（热重载，不用先 build）：
```bash
cd server && npm run dev     # tsx watch src/index.ts
```

数据默认落在项目根的 `data/` 下。可用环境变量 `RO_SERVER_PORT` / `RO_CONFIG` / `RO_DB_DIR` 覆盖路径（见下）。

> **端口**：默认 `23330`。
> **数据持久化**：`config.yaml` 和 `data/{downloads,sources,db}`；Docker 方式已 volume 映射到宿主机，容器重建不丢历史。

---

## 配置说明（config.yaml）

```yaml
server:
  host: 0.0.0.0          # 容器内监听地址；对外暴露由 compose 端口映射控制
  port: 23330

auth:
  enabled: true          # 关掉(false)则全放行——仅在完全可信的内网这么做
  apiKey: ""             # 建议留空，用 Web「生成 API Key」功能生成（见下）
  webLogin:
    username: admin
    password: ""         # 【必设】空密码禁止登录，首次务必设置

download:
  dir: data/downloads    # 相对项目根解析
  concurrency: 3         # 并发下载数(1-10)，改后即时生效
  defaultQuality: flac   # flac24bit | flac | 320k | 128k
  nameTemplate: "{name} - {singer}"
  embedCover: true       # 嵌入封面
  embedLyric: true       # 嵌入歌词
  coverSize: 500         # 封面尺寸(100-1000)

sources:
  dir: data/sources
  hotReload: true        # 音源目录热重载

rateLimit:
  enabled: true
  windowMs: 60000        # 限流窗口
  max: 300               # 窗口内最大请求数，仅 /api/* 生效

smokeTest:
  enabled: true
  cron: 0 6 * * *        # 每天 06:00
  keyword: 周杰伦
  checkLyric: true
  checkPic: true
  alertThreshold: 2      # 连续失败达阈值才告警
  alert:
    bark:
      enabled: false
      serverUrl: https://api.day.app
      deviceKey: ""
    serverChan:
      enabled: false
      sendKey: ""

log:
  level: info
```

### 环境变量覆盖

以下环境变量优先于 `config.yaml`（compose 里已设了前两个）：

| 变量 | 作用 |
|---|---|
| `RO_SERVER_PORT` | 覆盖监听端口 |
| `RO_SERVER_HOST` | 覆盖监听地址 |
| `RO_AUTH_APIKEY` | 覆盖 API Key |
| `RO_LOG_LEVEL` | 覆盖日志级别 |
| `RO_CONFIG` | 指定 config.yaml 路径（默认项目根） |
| `RO_DB_DIR` | SQLite 目录（默认 `data/db`） |

> **安全提示**：密钥类字段（`apiKey` / `webLogin.password` / `deviceKey` / `sendKey`）经 API 读取时**只回传是否已设置的布尔值，绝不回明文**；PATCH 时传空串表示「不修改」。

---

## 音源管理

Ro 不内置音源，需导入 lx-music 格式的音源脚本(`.js`)。三种方式：

1. **Web 后台 → 音源管理页**：本地文件上传，或在线 URL 导入
2. **直接放文件**：把 `.js` 丢进 `data/sources/`，开启 `hotReload` 会自动加载
3. **API**：见下方音源接口

导入后可在音源页查看每个音源支持的平台与音质、启停、热重载、删除。

---

## 跨平台换源机制

对齐 lx-music 原版的两段式逻辑，是**取 URL 失败时的核心兜底**，不是可选优化：

1. **主平台音质降级链**：按 `flac24bit → flac → 320k → 128k` 在主平台+指定音源逐级尝试
2. **全失败 → 跨平台换源**：`findMusic({name, singer, albumName?, interval?, source})` 在其它平台匹配同一首歌，逐候选平台各试一次（对齐原版 `retryedSource`，每平台只试一次防止无限重试）

**换源后的元数据处理：**
- 歌词 / 封面：走**实际命中平台**
- 文件标题 / 歌手 / 专辑：仍用**原曲信息**
- 任务状态标记为 `completed_with_warnings`，`actual_source` 记为 `real-source@kw` 形式

---

## REST API 文档

所有接口前缀 `/api/v1`。鉴权见 [鉴权与 API Key](#鉴权与-api-key)。返回均为 JSON（SSE 除外）。

### 鉴权 Auth

| 方法 | 路径 | 说明 | Body / 参数 |
|---|---|---|---|
| POST | `/auth/login` | 登录，成功设 `ro_sess` Cookie | `{ username, password }` |
| POST | `/auth/logout` | 登出，清 Cookie | — |
| GET | `/auth/status` | 鉴权状态 | 返回 `{ enabled, authenticated, passwordConfigured }` |

### 状态 Status

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/status` | 应用状态：版本、uptime、node 版本、内存(MB)、音源数、任务分布 |

### 搜索 Search

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/search?keyword=晴天&platform=kw&page=1&limit=20` | 单平台歌曲搜索 |
| GET | `/search/aggregate?keyword=晴天&platforms=kw,wy&page=1` | 聚合搜索（`platforms` 省略=全平台）|
| GET | `/search/songlist?keyword=周杰伦&platform=kw&page=1` | 单平台歌单搜索 |
| GET | `/search/songlist/aggregate?keyword=周杰伦&page=1` | 聚合歌单搜索 |
| GET | `/search/songlist/detail?platform=kw&id=<歌单ID>&page=1` | 歌单详情（含歌曲列表）|

### 下载 / 任务 Download

| 方法 | 路径 | 说明 | Body |
|---|---|---|---|
| POST | `/download` | 提交单曲下载 | `{ platform, musicInfo, quality?, primarySourceId?, sourceIds? }` |
| POST | `/download/batch` | 批量下载（≤200 首）| `{ items:[{platform,musicInfo,quality?}], quality?, primarySourceId?, sourceIds? }` |
| GET | `/tasks?status=` | 任务列表（可按状态过滤）| — |
| GET | `/tasks/:id` | 单任务详情 | — |
| POST | `/tasks/:id/retry` | 重试 | — |
| POST | `/tasks/:id/cancel` | 取消 | — |
| DELETE | `/tasks/:id` | 删除记录 | — |

> `musicInfo` 至少需含 `songmid` 与 `name`。任务状态：`pending / active / completed / completed_with_warnings / failed / canceled`。

### 歌单 Playlists

| 方法 | 路径 | 说明 | Body |
|---|---|---|---|
| GET | `/playlists` | 歌单列表（含歌曲数）| — |
| POST | `/playlists` | 创建 | `{ name, description? }` |
| GET | `/playlists/:id` | 详情（含歌曲）| — |
| PATCH | `/playlists/:id` | 改名/改描述 | `{ name?, description? }` |
| DELETE | `/playlists/:id` | 删除 | — |
| POST | `/playlists/:id/items` | 添加歌曲 | `{ platform, musicInfo }` |
| DELETE | `/playlists/:id/items/:itemId` | 移除歌曲 | — |
| POST | `/playlists/:id/download` | 整单批量下载 | `{ quality? }` |

### 音源 Sources

| 方法 | 路径 | 说明 | Body |
|---|---|---|---|
| GET | `/sources` | 列表（状态/平台/音质）| — |
| POST | `/sources/import/content` | 粘贴脚本内容导入 | `{ name, content }` |
| POST | `/sources/import/url` | 在线 URL 导入 | `{ url, name? }` |
| POST | `/sources/upload` | multipart 文件上传（≤5MB）| form-data 文件字段 |
| PATCH | `/sources/:id/enabled` | 启停 | `{ enabled }` |
| POST | `/sources/:id/reload` | 热重载单个音源 | — |
| DELETE | `/sources/:id` | 删除 | — |

### 设置 Settings

| 方法 | 路径 | 说明 | Body |
|---|---|---|---|
| GET | `/settings` | 脱敏配置视图（不含密钥明文）| — |
| PATCH | `/settings` | 局部更新（下载/告警/冒烟）| 见下 |
| POST | `/settings/apikey/generate` | 生成新 API Key（**仅此次返回明文**）| — |
| DELETE | `/settings/apikey` | 撤销当前 API Key | — |
| POST | `/settings/notify/test` | 测试告警推送 | `{ title?, body? }` |

PATCH `/settings` body 示例：
```json
{
  "download": { "concurrency": 3, "defaultQuality": "flac", "coverSize": 500 },
  "smokeTest": { "enabled": true, "cron": "0 6 * * *", "keyword": "周杰伦" }
}
```

### 健康 Health

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health/smoke` | 最近一次冒烟结果 + 平台×音源矩阵 |
| GET | `/health/smoke/trend?days=7` | 最近 N 天趋势 |
| POST | `/health/smoke/run` | 手动触发一次冒烟（异步，返回 202）|

---

## SSE 实时事件

```
GET /api/v1/sse/subscribe
```

`Content-Type: text/event-stream`，服务端每 15s 发注释行心跳。事件格式 `event: <name>\ndata: <json>\n\n`。

**事件类型**：`connected`、`task:created`、`task:active`、`task:progress`、`task:completed`、`task:completed_with_warnings`、`task:failed`、`task:canceled`、`source:changed`、`source:update-alert`、`smoke:completed`、`smoke:failed`。

> 断线重连后应调用 `GET /api/v1/tasks` 做一次全量对账。

浏览器示例：
```js
const es = new EventSource('/api/v1/sse/subscribe')
es.addEventListener('task:progress', (e) => console.log(JSON.parse(e.data)))
```

---

## 鉴权与 API Key

两种通行方式（`auth.enabled=false` 时全放行）：

### 1. Web 登录
用户名 + 密码 → 签发内存 session token → 写 `HttpOnly` Cookie（`ro_sess`，7 天）。重启服务 session 失效，重新登录即可。

> **空密码禁止登录**：首次部署务必在 `config.yaml` 设 `auth.webLogin.password`。

### 2. API Key（给脚本 / 自动化）
请求头二选一：
```
x-api-key: ro_xxxxxxxx...
# 或
Authorization: Bearer ro_xxxxxxxx...
```

**生成方式（推荐用 Web 后台）**：设置页 → 「API Key」卡片 → 生成。
- Key 格式 `ro_` + 32 字节 base64url
- **明文仅在生成的那一次显示**，请立即复制保存；之后任何读取只能看到「已设置」，无法再查看明文，只能重新生成
- 「重新生成」会使旧 Key 立即失效；「撤销」清空 Key

curl 示例：
```bash
# 登录拿 cookie
curl -c cookies.txt -X POST http://<IP>:23330/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"<你的密码>"}'

# 生成 API Key（明文只这一次）
curl -b cookies.txt -X POST http://<IP>:23330/api/v1/settings/apikey/generate

# 之后用 API Key 调接口（无需 cookie）
curl -H 'x-api-key: ro_xxxx' 'http://<IP>:23330/api/v1/search?keyword=晴天&platform=kw'
```

---

## 健康冒烟测试

定时（默认每天 06:00）跑真实下载链路，对每个音源 × 每个平台跑一次搜索+取 URL（可选校验歌词/封面），生成 🟢/🟡/🔴 矩阵。连续失败达 `alertThreshold` 时通过 Bark / Server酱 告警。

- 平台间**串行 + 间隔 ≥3s**，防触发风控
- 手动触发：健康页「立即冒烟测试」或 `POST /api/v1/health/smoke/run`
- 配了哪个告警渠道就用哪个，都配则同时推送

---

## 内存占用

实测稳定 **RSS ≈ 198MB**（目标 <300MB 达标）。compose 里设了 `mem_limit: 512m` 留足余量。低占用得益于用 SQLite + p-queue 替代 Redis/BullMQ。

---

## Docker 镜像说明

**镜像仓库**：[`a914599611/ro-music`](https://hub.docker.com/r/a914599611/ro-music)（Docker Hub）

### 标签（Tags）

| 标签 | 说明 |
|---|---|
| `latest` | 最新稳定版，跟随 `main` 分支 |
| `0.1.0` | 固定版本号（语义化版本），生产环境建议锁定具体版本 |

### 支持架构

多架构镜像（manifest list），`docker pull` / `docker run` 会**自动匹配当前 CPU 架构**：

- `linux/amd64`（x86_64 服务器 / PC）
- `linux/arm64`（Apple Silicon、树莓派 4/5、ARM 云主机等）

### 镜像内部结构

多阶段构建产出精简运行镜像：

- **基础镜像**：`node:22-bookworm-slim`（运行阶段）
- **工作目录**：`/app/server`，入口 `node dist/index.js`
- **暴露端口**：`23330`
- **内置健康检查**：每 30s 探测 `/api/v1/status`（鉴权开启返回 401 也算存活，仅连接失败判宕机）
- **预置环境变量**：`NODE_ENV=production`、`TZ=Asia/Shanghai`、`RO_SERVER_HOST=0.0.0.0`、`RO_SERVER_PORT=23330`、`RO_DB_DIR=/app/data/db`

### 需要挂载的卷（volume）

镜像**不含**任何配置和数据（干净镜像），运行时通过 volume 注入：

| 容器内路径 | 用途 | 是否必需 |
|---|---|---|
| `/app/config.yaml` | 配置文件（用户名/密码/apiKey/各项设置）| **必需** |
| `/app/data/downloads` | 下载的音乐文件 | 建议 |
| `/app/data/sources` | lx-music 音源脚本(.js) | **必需**（否则无音源）|
| `/app/data/db` | SQLite（任务记录/歌单）| 建议（否则重建容器丢历史）|

> **镜像不含密钥**：镜像里没有任何 `config.yaml` 或 `data/`（`.dockerignore` 已排除），密码/apiKey 完全由你挂载的 `config.yaml` 提供，公开镜像不泄露任何凭据。

### 自己构建并推送多架构镜像

```bash
# 一次性准备（注册 QEMU 跨架构模拟 + 创建 buildx builder）
docker run --privileged --rm tonistiigi/binfmt --install arm64
docker buildx create --name robuilder --driver docker-container --use

# 构建 amd64 + arm64 并推送
docker login -u <你的用户名>
docker buildx build --platform linux/amd64,linux/arm64 \
  -t <你的用户名>/ro-music:0.1.0 \
  -t <你的用户名>/ro-music:latest \
  --push .
```

---

## 外部控制：局域网 vs 公网

Ro 的原始定位是**纯个人自用 / 局域网部署**。如何暴露取决于你的场景：

### 场景 A：局域网自用（推荐 / 默认）

- `server.host: 0.0.0.0` + compose 端口映射 `23330:23330`
- 局域网内任意设备访问 `http://<服务器内网IP>:23330/`
- 鉴权：设好 Web 登录密码即可；API Key 按需生成
- **不要**把 23330 端口转发/映射到公网

### 场景 B：公网访问（需自行加固，超出自用定位）

> ⚠️ **风险提示**：公网暴露音乐下载服务涉及版权与安全风险，且本项目为轻量自用设计（session 存内存、无 CSRF token、无审计日志）。以下为**最低加固清单**，是否上公网及合规风险请自行评估。

最低加固要求：

1. **改掉默认弱密码**：`admin/admin` 绝不可用于公网；设强密码
2. **启用 API Key** 并妥善保管
3. **反向代理 + HTTPS**：用 Nginx/Caddy 套 TLS，不要裸 HTTP 暴露
   ```nginx
   # Nginx 示例（注意 SSE 需要关闭缓冲）
   location / {
     proxy_pass http://127.0.0.1:23330;
     proxy_http_version 1.1;
     proxy_set_header Connection '';
     proxy_buffering off;              # SSE 必需
     proxy_read_timeout 3600s;
   }
   ```
4. **防火墙**：只放行反代端口(443)，`23330` 仅监听 `127.0.0.1`（把 compose 端口映射改为 `127.0.0.1:23330:23330`，让 Nginx 走本机回环）
5. **收紧限流**：降低 `rateLimit.max`
6. 考虑加 fail2ban / 基础访问日志监控

---

## 常见问题 / 排错

**Q: `docker compose build` 报 `npm error disturl is not a valid npm option`？**
A: node22 自带的 npm10+ 已移除 `disturl` 配置项。Dockerfile 已改用环境变量 `ENV npm_config_disturl=...` 注入给 node-gyp，重新拉取最新 Dockerfile 即可。

**Q: 登录一直失败 / 提示未设置密码？**
A: `config.yaml` 的 `auth.webLogin.password` 为空。空密码禁止登录，设好密码后 `docker compose restart`。

**Q: 搜到的歌下载失败？**
A: 单个平台/音源可能临时不可用。Ro 会自动走跨平台换源兜底；若所有平台都失败，检查音源脚本是否有效（音源页看状态）。

**Q: 换源后文件标了 `completed_with_warnings`？**
A: 正常。表示主平台取 URL 失败、通过其它平台命中了同款；文件曲目信息用原曲，歌词/封面用实际命中平台。

**Q: SSE 在反代后收不到事件？**
A: 反代需关闭响应缓冲（Nginx `proxy_buffering off;`），否则事件会被缓冲住。

**Q: 音源导入了但不生效？**
A: 确认 `sources.hotReload: true`，或在音源页手动「热重载」；查看音源状态是否 `ready`。

---

## License

Apache-2.0
