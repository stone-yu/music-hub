# 🎵 Navidrome AI 智能歌单生成器

从各大音乐平台搜索 / 抓取热门歌单与排行榜，自动匹配你的 Navidrome 曲库，勾选已收录歌曲一键创建带封面的歌单，或加入已有歌单。

## ✨ 功能特性

### 🏠 多页面工作台
- **首页**：各平台热歌 Top5（每行3个平台）+ 热榜歌单 Top5，标注每首是否已在曲库
- **热门歌曲**：各平台歌曲排行榜（网易云/QQ/酷狗），已匹配/未匹配分组展示
- **热门歌单**：各平台热门歌单网格，点击进入歌单详情页
- **搜索歌单**：按主题搜索各平台，结果同页展示（不跳转）
- **手动粘贴**：粘贴歌单链接导入
- **我的歌单**：查看 Navidrome 已有歌单（只读）

### 🧠 智能匹配
- 搜索/导入结果自动与 Navidrome 曲库匹配
- 精确匹配 + 模糊匹配（容忍歌名差异）
- 跨平台结果按库内歌曲去重（同一首不会重复出现）
- 显示「歌曲总数 / 已有 / 未找到 / 匹配率」统计

### ✅ 创建 / 加入歌单
- 左侧菜单底部常驻「已选择 N 首」+ 两个操作按钮
- **创建歌单**：弹窗填名称、选封面（歌单来源用原封面，排行榜来源自动生成 22 种主题封面）、可删减歌曲
- **加入歌单**：选择已有 Navidrome 歌单追加，自动跳过已存在的歌曲

### 🎨 自动生成封面
- 22 种主题风格：民谣/摇滚/电子/古典/流行/爵士/嘻哈/R&B/国风/粤语/深夜/运动/80后/90后 等
- 创建前可预览、换封面

### 🔒 安全
- 密码保护的 Web UI，24 小时会话有效期
- 配置走环境变量 / `.env` 文件，不进 git

## 🚀 使用方式

### 方式一：本地开发启动

适合二次开发或本地体验。

```bash
# 1. 克隆
git clone <仓库地址>
cd ai-playlist

# 2. 创建虚拟环境并安装依赖
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入你的 Navidrome 地址、账号密码、Web 访问密码

# 4. 启动
.venv/bin/python app.py
```

浏览器打开 `http://127.0.0.1:8899`，输入 `.env` 里的 `LOGIN_PASSWORD` 登录。

> 必需的环境变量缺失时启动会报错退出，请确保 `.env` 配置完整。

### 方式二：Docker Compose 部署（推荐）

适合部署到 NAS / 服务器。

```bash
# 1. 克隆
git clone <仓库地址>
cd ai-playlist

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入实际值

# 3. 构建并启动
docker compose up -d --build
```

浏览器打开 `http://你的服务器IP:8899` 登录。

常用命令：

```bash
docker compose logs -f        # 查看日志
docker compose restart        # 重启
docker compose down           # 停止并删除容器
docker compose up -d --build  # 更新代码后重新构建部署
```

### 方式三：使用预构建镜像（GHCR）

打 tag 后 GitHub Actions 会自动构建并推送镜像到 ghcr.io，可直接拉取无需本地构建。

把 `docker-compose.yml` 里的 `build: .` 注释掉、取消 `image` 注释：

```yaml
services:
  navidrome-ai-playlist:
    image: ghcr.io/stone-yu/ai-playlist:latest
    container_name: navidrome-ai-playlist
    restart: unless-stopped
    ports:
      - "8899:8899"
    environment:
      NAVIDROME_URL: "http://你的Navidrome地址:4533/"
      NAVIDROME_USER: "你的用户名"
      NAVIDROME_PASS: "你的密码"
      LOGIN_PASSWORD: "你的Web访问密码"
      PORT: "8899"
      DOWNLOAD_DIR: "/app/downloads"
      SCRAPED_DIR: "/app/scraped"
      DATA_DIR: "/app/data"
    volumes:
      # 下载的歌曲（让 Navidrome 也挂载此目录即可扫描入库）
      - ./downloads:/app/downloads
      # 刮削整理后的歌曲（按 艺术家/专辑 结构）
      - ./scraped:/app/scraped
      # 持久化数据（download_task.json 等任务记录）
      - ./data:/app/data
```

```bash
docker compose up -d
```

> 首次使用需先打个 tag 触发构建：`git tag v1.0.0 && git push origin v1.0.0`。
> 构建完成后到 GitHub → Packages 把包可见性设为 public，才能免登录拉取。
> 构建完成后到 GitHub → Packages 把包可见性设为 public，才能免登录拉取。

## ⚙️ 环境变量

复制 `.env.example` 为 `.env` 并填入：

| 环境变量 | 必需 | 说明 | 示例 |
|---------|------|------|------|
| `NAVIDROME_URL` | ✅ | Navidrome 地址（末尾加 `/`） | `http://192.168.1.100:4533/` |
| `NAVIDROME_USER` | ✅ | Navidrome 用户名 | `admin` |
| `NAVIDROME_PASS` | ✅ | Navidrome 密码 | `your_password` |
| `LOGIN_PASSWORD` | ✅ | Web UI 访问密码 | `your_web_password` |
| `PORT` | ❌ | 服务端口（默认 8899） | `8899` |
| `SEARCH_TIMEOUT` | ❌ | 搜索超时秒数（默认 10） | `10` |

## 🎯 各页面用法

- **首页 / 热门歌曲 / 热门歌单**：浏览各平台内容，点击歌单进详情页，勾选已匹配歌曲
- **搜索歌单**：输入主题（如「周杰伦」「深夜emo」「80后经典」），选来源平台，搜索匹配
- **手动粘贴**：粘贴网易云/QQ/酷我/酷狗歌单链接 → 跳转详情页匹配
- **歌单详情页**：展示歌单封面 + 匹配统计 + 已匹配/未匹配歌曲网格，勾选后用左侧「创建歌单」或「加入歌单」
- **创建歌单**：填名称、选封面、可删减歌曲 → 创建到 Navidrome
- **加入歌单**：选已有 Navidrome 歌单追加（自动去重）

## 📁 项目结构

```
ai-playlist/
├── app.py                 # FastAPI 主应用（入口）
├── config.py              # 配置（环境变量加载与校验）
├── app/                   # 业务代码包
│   ├── navidrome_client.py    # Navidrome Subsonic API 客户端
│   ├── cover_generator.py     # 封面生成器（22种主题）
│   ├── playlist_parser.py     # 歌单链接解析
│   ├── hot_playlists.py       # 各平台热门歌单
│   └── hot_songs.py           # 各平台歌曲排行榜
├── searchers/
│   └── __init__.py        # 多平台搜索引擎（酷我/网易/QQ/酷狗）
├── templates/
│   ├── login.html         # 登录页
│   └── app.html           # 主应用页（多页路由）
├── .env.example           # 环境变量模板
├── .github/workflows/     # GitHub Actions（自动构建 Docker 镜像到 ghcr.io）
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

## 🛠️ 技术栈

- **后端**：Python + FastAPI + uvicorn
- **前端**：HTML + Tailwind CSS + 原生 JS（多页路由）
- **音乐平台**：酷我、网易云、QQ音乐、酷狗（非官方接口）
- **音乐服务器**：Navidrome (Subsonic API)
- **封面生成**：Pillow
- **部署**：Docker / Docker Compose / GHCR

## ⚠️ 注意事项

- 首次启动后台加载歌曲库（曲库越大越慢，317 位艺术家约 1-2 分钟）
- 各音乐平台接口为非官方逆向，可能随平台变动失效；已做容错，单平台挂了不影响其他
- 匹配含精确 + 模糊匹配，可能有遗漏或误判
- `NAVIDROME_URL` 建议用局域网 IP，速度更快
- 切勿将 `.env` 提交到 git（已在 `.gitignore` 中）

## 📄 License

MIT
