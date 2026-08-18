# MusicHub

> 基于 Navidrome 的音乐曲库管理 + 多平台音乐下载工具。
> 搜索/试听/下载全网音乐，自动刮削整理入库 Navidrome，生成 AI 歌单。

---

## 特性

- **多平台搜索**：网易云 / QQ音乐 / 酷狗 / 酷我 / 咪咕，聚合搜索 + 各平台热榜
- **试听 + 下载**：在线试听 128k，下载支持 Hi-Res/无损/320k/128k 多音质选择
- **曲库匹配**：搜索结果自动匹配 Navidrome 已有曲库，标记"已在曲库/未收录"
- **自动刮削**：下载完成自动整理到 `艺术家/专辑/` 目录，嵌入元数据/歌词/封面，触发 Navidrome 扫描入库
- **AI 歌单**：勾选已匹配歌曲一键创建 Navidrome 歌单
- **热榜歌单**：各平台歌单广场浏览 + URL 解析导入
- **音源管理**：lx-music 音源脚本热重载，跨平台换源兜底
- **亮色/暗色主题**：一键切换

---

## 快速开始

### Docker Compose（推荐）

```bash
# 1. 准备目录
mkdir -p data/downloads data/sources data/db data/scraped

# 2. 下载配置模板
curl -fsSL https://raw.githubusercontent.com/stone-yu/music-hub/main/config.example.yaml -o config.yaml

# 3. 启动
docker compose up -d
```

访问 `http://服务器IP:4733`，用 config.yaml 里的密码登录。

### Docker

```bash
docker run -d --name music-hub \
  -p 4733:23330 \
  -e NAVIDROME_URL="http://your-navidrome:4533/" \
  -e NAVIDROME_USER="your-username" \
  -e NAVIDROME_PASS="your-password" \
  -e LOGIN_PASSWORD="your-login-password" \
  -v ./data/downloads:/app/data/downloads \
  -v ./data/scraped:/app/data/scraped \
  -v ./data/sources:/app/data/sources \
  -v ./data/db:/app/data/db \
  -v ./config.yaml:/app/config.yaml \
  ghcr.io/stone-yu/music-hub:latest
```

---

## 配置

两种方式配置（环境变量优先级更高）：

### 环境变量

| 变量 | 说明 |
|------|------|
| `NAVIDROME_URL` | Navidrome 地址 |
| `NAVIDROME_USER` | Navidrome 用户名 |
| `NAVIDROME_PASS` | Navidrome 密码 |
| `LOGIN_PASSWORD` | Web 登录密码 |
| `TZ` | 时区（默认 Asia/Shanghai） |

### config.yaml

从 `config.example.yaml` 复制，包含下载/刮削/音源/冒烟测试等完整配置。

---

## 目录结构

```
music-hub/
├── server/                # Node.js + Fastify 后端
│   └── src/
│       ├── core/          # 核心逻辑（搜索/下载/刮削/曲库/音源引擎）
│       └── routes/        # REST API 路由
├── web/                   # 前端（原生 HTML/CSS/JS）
├── data/                  # 运行数据
│   ├── downloads/         # 下载的音乐文件
│   ├── scraped/           # 刮削整理后的音乐（映射到 Navidrome 音乐目录）
│   ├── sources/           # lx-music 音源脚本(.js)
│   └── db/                # SQLite 数据库
├── config.yaml            # 配置文件
├── docker-compose.yml     # Docker Compose 编排
└── Dockerfile             # 多阶段构建
```

---

## 音源脚本

下载/试听需要导入 lx-music 音源脚本（`.js`）。在「音源管理」页面上传或粘贴 URL 导入。

音源脚本从 lx-music 社区获取，支持热重载，失效后更换即可。

---

## 技术栈

- **后端**：Node.js + Fastify + TypeScript + SQLite
- **前端**：原生 HTML/CSS/JS（无框架，轻量）
- **音源引擎**：lx-music 音源脚本沙箱执行器
- **元数据**：node-id3 (MP3) / flac-tagger (FLAC) / sharp (封面)

---

## 免责声明

下载的音乐资源请于 24 小时内删除，不得用于任何商业用途。因使用本项目产生的任何法律后果由使用者自行承担，作者不承担任何责任。
