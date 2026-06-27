# 🎵 Navidrome AI 智能歌单生成器

通过 AI 搜索各大音乐平台，自动匹配你的 Navidrome 曲库，一键生成歌单。

## ✨ 功能

- 🔍 **多平台搜索**：酷我音乐、网易云音乐、QQ音乐、酷狗音乐
- 🧠 **智能匹配**：自动将搜索结果与 Navidrome 曲库匹配（精确+模糊）
- ✅ **一键创建**：匹配到的歌曲直接创建为 Navidrome 歌单
- 🎨 **自动生成封面**：根据歌单主题智能生成精美封面，22种主题风格可选
- 🔒 **密码保护**：访问需要登录密码
- 📊 **匹配报告**：显示搜索数量、匹配率、未找到的歌曲

## 🚀 部署到飞牛 NAS（Docker）

### 第一步：上传项目

把整个 `navidrome-ai-playlist` 文件夹上传到你的飞牛 NAS，比如放到 `/vol1/docker/navidrome-ai-playlist/`

### 第二步：修改配置

编辑 `docker-compose.yml`，修改以下配置：

```yaml
environment:
  # Navidrome 服务器地址（改成你飞牛的局域网 IP）
  - NAVIDROME_URL=http://192.168.x.x:4533/
  # Navidrome 登录信息
  - NAVIDROME_USER=ccson
  - NAVIDROME_PASS=你的Navidrome密码
  # Web UI 访问密码（改成你自己的）
  - LOGIN_PASSWORD=你的访问密码
```

> 💡 **建议**：`NAVIDROME_URL` 使用局域网地址（如 `http://192.168.1.x:4533/`），速度更快。

### 第三步：构建并启动

在飞牛的终端（SSH）中执行：

```bash
cd /vol1/docker/navidrome-ai-playlist
docker-compose up -d --build
```

等待构建完成（首次约 2-3 分钟），看到 `Started` 就表示成功了。

### 第四步：访问

在浏览器打开：`http://飞牛IP:8899`

输入你设置的 `LOGIN_PASSWORD` 即可进入。

## 🎯 使用方法

1. 在搜索框输入歌单主题，例如：
   - 「民谣歌单」
   - 「80后经典」
   - 「周杰伦精选」
   - 「深夜emo」
   - 「开车必听」
2. 点击「AI 搜索匹配」，等待 10-30 秒
3. 查看匹配结果，勾选/取消想要的歌曲
4. 点击「创建歌单」
5. 打开 Navidrome，歌单已创建完成！

## 📝 配置说明

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| NAVIDROME_URL | Navidrome 服务器地址 | http://j.tthsdd.top:4533/ |
| NAVIDROME_USER | Navidrome 用户名 | ccson |
| NAVIDROME_PASS | Navidrome 密码 | shaozi1981 |
| LOGIN_PASSWORD | Web UI 访问密码 | navidrome2024 |
| PORT | 服务端口 | 8899 |

## ⚙️ 不用 Docker 直接运行

```bash
# 需要 Python 3.9+
pip install -r requirements.txt

# 修改 config.py 中的配置

# 启动
python app.py
```

## 🔧 常用命令

```bash
# 查看日志
docker-compose logs -f

# 重启
docker-compose restart

# 停止
docker-compose down

# 更新后重新构建
docker-compose up -d --build
```

## ⚠️ 注意事项

- 首次启动会预加载歌曲库（后台进行），歌曲越多加载越慢
- 搜索结果取决于各音乐平台 API 的可用性
- 匹配算法会尝试精确匹配和模糊匹配，但可能有遗漏
- 建议定期重启容器以保持最佳性能
