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
