"""
Navidrome AI 智能歌单生成器 - 配置
所有必需项必须通过环境变量提供，缺失时启动即报错。
"""
import os
import sys


def _require(name: str) -> str:
    val = os.getenv(name, "").strip()
    if not val:
        print(f"[配置错误] 必需的环境变量 {name} 未设置。请通过环境变量提供。", file=sys.stderr)
        sys.exit(1)
    return val


# ========== Navidrome 服务器配置（必需）==========
NAVIDROME_URL = _require("NAVIDROME_URL")
NAVIDROME_USER = _require("NAVIDROME_USER")
NAVIDROME_PASS = _require("NAVIDROME_PASS")

# ========== Web UI 登录密码（必需）==========
LOGIN_PASSWORD = _require("LOGIN_PASSWORD")

# ========== 服务配置 ==========
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8899"))

# ========== 搜索配置 ==========
SEARCH_TIMEOUT = int(os.getenv("SEARCH_TIMEOUT", "10"))
MAX_RESULTS_PER_SOURCE = 30

# ========== 下载配置（未匹配歌曲下载到本地，供 Navidrome 扫描入库）==========
# 下载目录（容器内路径，需在 docker-compose 中映射到宿主机，并让 Navidrome 也挂载该目录）
DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "/app/downloads")
# 下载源（当前仅酷我，架构支持扩展）
DOWNLOAD_SOURCE = os.getenv("DOWNLOAD_SOURCE", "酷我")

# 刮削目录（刮削后的文件按 艺术家/专辑 整理到此，需映射卷让 Navidrome 扫描）
SCRAPED_DIR = os.getenv("SCRAPED_DIR", "/app/scraped")

# 数据目录（存放 download_task.json 等持久化数据）
DATA_DIR = os.getenv("DATA_DIR", "/app/data")
