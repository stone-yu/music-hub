"""
Navidrome AI 智能歌单生成器 - 配置
"""
import os

# ========== Navidrome 服务器配置 ==========
NAVIDROME_URL = os.getenv("NAVIDROME_URL", "http://j.tthsdd.top:4533/")
NAVIDROME_USER = os.getenv("NAVIDROME_USER", "ccson")
NAVIDROME_PASS = os.getenv("NAVIDROME_PASS", "shaozi1981")

# ========== Web UI 登录密码 ==========
LOGIN_PASSWORD = os.getenv("LOGIN_PASSWORD", "navidrome2024")

# ========== 服务配置 ==========
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8899"))

# ========== 搜索配置 ==========
SEARCH_TIMEOUT = int(os.getenv("SEARCH_TIMEOUT", "10"))
MAX_RESULTS_PER_SOURCE = 30
