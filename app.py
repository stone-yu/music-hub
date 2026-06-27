"""
Navidrome AI 智能歌单生成器 - 主应用
"""
import os
import json
import time
import logging
import secrets
import threading
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, Request, Response, HTTPException, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

import config
from searchers import search_all, search_all_merged, Song
from navidrome_client import NavidromeClient
from cover_generator import generate_cover, THEME_COLORS

# 日志配置
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="Navidrome AI Playlist Generator")

# 模板和静态文件
BASE_DIR = Path(__file__).parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

# 会话存储（简单 token 方式）
active_sessions = {}

# Navidrome 客户端
navidrome = NavidromeClient(config.NAVIDROME_URL, config.NAVIDROME_USER, config.NAVIDROME_PASS)

# 歌曲库缓存
library_cache = {"songs": [], "last_update": 0, "loading": False}
CACHE_TTL = 600  # 10分钟刷新一次


# ==================== 中间件 ====================
def get_session_token(request: Request) -> Optional[str]:
    return request.cookies.get("session_token")

def is_authenticated(request: Request) -> bool:
    token = get_session_token(request)
    if token and token in active_sessions:
        # 检查是否过期（24小时）
        if time.time() - active_sessions[token] < 86400:
            return True
        del active_sessions[token]
    return False

def require_auth(request: Request):
    if not is_authenticated(request):
        raise HTTPException(status_code=401, detail="未登录")


# ==================== 页面路由 ====================
@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    if is_authenticated(request):
        return RedirectResponse(url="/app")
    return RedirectResponse(url="/login")

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, error: str = ""):
    return templates.TemplateResponse("login.html", {"request": request, "error": error})

@app.post("/login")
async def do_login(request: Request, password: str = Form(...)):
    if password == config.LOGIN_PASSWORD:
        token = secrets.token_hex(32)
        active_sessions[token] = time.time()
        response = RedirectResponse(url="/app", status_code=302)
        response.set_cookie("session_token", token, httponly=True, max_age=86400)
        return response
    return templates.TemplateResponse("login.html", {
        "request": request,
        "error": "密码错误，请重试"
    })

@app.get("/app", response_class=HTMLResponse)
async def app_page(request: Request):
    if not is_authenticated(request):
        return RedirectResponse(url="/login")
    return templates.TemplateResponse("app.html", {"request": request})

@app.get("/logout")
async def logout(request: Request):
    token = get_session_token(request)
    if token and token in active_sessions:
        del active_sessions[token]
    response = RedirectResponse(url="/login")
    response.delete_cookie("session_token")
    return response


# ==================== API 路由 ====================
class SearchRequest(BaseModel):
    query: str
    sources: list = []  # 空列表表示全部

class CreatePlaylistRequest(BaseModel):
    name: str
    song_ids: list
    cover_theme: str = ""  # 封面主题（可选）
    cover_enabled: bool = True  # 是否生成封面

class MatchRequest(BaseModel):
    query: str
    sources: list = []

@app.get("/api/status")
async def api_status(request: Request):
    require_auth(request)
    connected = navidrome.ping()
    return {
        "navidrome_connected": connected,
        "library_size": len(library_cache.get("songs", [])),
        "library_loading": library_cache.get("loading", False),
    }

@app.post("/api/search")
async def api_search(req: SearchRequest, request: Request):
    require_auth(request)
    if not req.query.strip():
        raise HTTPException(400, "搜索关键词不能为空")

    logger.info(f"搜索: {req.query}, 来源: {req.sources or '全部'}")

    if req.sources:
        # 指定来源搜索
        from searchers import ALL_SEARCHERS
        results = {}
        for name, searcher in ALL_SEARCHERS:
            if name in req.sources:
                try:
                    songs = searcher(req.query, config.MAX_RESULTS_PER_SOURCE)
                    results[name] = [s.to_dict() for s in songs]
                except Exception as e:
                    logger.error(f"[{name}] 搜索失败: {e}")
                    results[name] = []
        total = sum(len(v) for v in results.values())
        return {"results": results, "total": total, "query": req.query}
    else:
        # 全平台搜索
        from searchers import ALL_SEARCHERS
        results = {}
        for name, searcher in ALL_SEARCHERS:
            try:
                songs = searcher(req.query, config.MAX_RESULTS_PER_SOURCE)
                results[name] = [s.to_dict() for s in songs]
            except Exception as e:
                logger.error(f"[{name}] 搜索失败: {e}")
                results[name] = []
        total = sum(len(v) for v in results.values())
        return {"results": results, "total": total, "query": req.query}

@app.post("/api/match")
async def api_match(req: MatchRequest, request: Request):
    require_auth(request)
    if not req.query.strip():
        raise HTTPException(400, "搜索关键词不能为空")

    # 1. 从各平台搜索
    logger.info(f"匹配搜索: {req.query}")
    from searchers import ALL_SEARCHERS, Song
    all_search_songs = []
    source_stats = {}

    searchers_to_use = ALL_SEARCHERS
    if req.sources:
        searchers_to_use = [(n, s) for n, s in ALL_SEARCHERS if n in req.sources]

    for name, searcher in searchers_to_use:
        try:
            songs = searcher(req.query, config.MAX_RESULTS_PER_SOURCE)
            source_stats[name] = len(songs)
            all_search_songs.extend(songs)
        except Exception as e:
            logger.error(f"[{name}] 搜索失败: {e}")
            source_stats[name] = 0

    # 2. 去重
    seen = set()
    unique_songs = []
    for song in all_search_songs:
        key = song.match_key
        if key not in seen:
            seen.add(key)
            unique_songs.append(song)

    # 3. 与 Navidrome 库匹配
    library = _get_library()
    lib_index = {}
    for ls in library:
        key = ls.match_key
        if key not in lib_index:
            lib_index[key] = ls

    matched = []
    unmatched = []
    for song in unique_songs:
        key = song.match_key
        if key in lib_index:
            ns = lib_index[key]
            matched.append({
                "title": ns.title,
                "artist": ns.artist,
                "album": ns.album,
                "id": ns.id,
                "source": song.source,
            })
        else:
            # 尝试模糊匹配：只要歌名包含
            found = False
            title_clean = re.sub(r'[\s\-\(\)（）]', '', song.title.lower())
            for lk, ls in lib_index.items():
                lib_title = re.sub(r'[\s\-\(\)（）]', '', ls.title.lower())
                if title_clean and lib_title and (title_clean in lib_title or lib_title in title_clean):
                    if len(title_clean) >= 2:  # 避免太短的误匹配
                        matched.append({
                            "title": ls.title,
                            "artist": ls.artist,
                            "album": ls.album,
                            "id": ls.id,
                            "source": f"{song.source}(模糊)",
                        })
                        found = True
                        break
            if not found:
                unmatched.append({
                    "title": song.title,
                    "artist": song.artist,
                    "source": song.source,
                })

    return {
        "query": req.query,
        "source_stats": source_stats,
        "search_total": len(unique_songs),
        "matched": matched,
        "matched_count": len(matched),
        "unmatched": unmatched[:50],  # 最多返回50个未匹配
        "unmatched_count": len(unmatched),
    }

@app.post("/api/playlist/create")
async def api_create_playlist(req: CreatePlaylistRequest, request: Request):
    require_auth(request)
    if not req.name.strip():
        raise HTTPException(400, "歌单名称不能为空")
    if not req.song_ids:
        raise HTTPException(400, "歌曲列表不能为空")

    logger.info(f"创建歌单: {req.name}, 歌曲数: {len(req.song_ids)}, 封面: {req.cover_enabled}")

    # 生成封面
    cover_data = None
    if req.cover_enabled:
        try:
            theme = req.cover_theme if req.cover_theme else None
            subtitle = f"{len(req.song_ids)} 首歌曲 · AI 生成"
            cover_data = generate_cover(req.name, subtitle=subtitle, theme=theme)
            logger.info(f"封面已生成: {len(cover_data)} bytes")
        except Exception as e:
            logger.warning(f"封面生成失败: {e}")

    result = navidrome.create_playlist(req.name, req.song_ids, cover_data=cover_data)
    if result:
        return {
            "success": True,
            "playlist_id": result.get("id"),
            "playlist_name": result.get("name"),
            "song_count": len(req.song_ids),
            "cover_generated": cover_data is not None,
        }
    else:
        raise HTTPException(500, "创建歌单失败")

@app.post("/api/cover/preview")
async def api_cover_preview(request: Request):
    """预览封面生成效果"""
    require_auth(request)
    try:
        body = await request.json()
        title = body.get("title", "歌单")
        theme = body.get("theme", "")
        song_count = body.get("song_count", 0)
        subtitle = f"{song_count} 首歌曲 · AI 生成" if song_count else ""
        cover_data = generate_cover(title, subtitle=subtitle, theme=theme or None)
        return Response(content=cover_data, media_type="image/jpeg")
    except Exception as e:
        logger.error(f"封面预览失败: {e}")
        raise HTTPException(500, "封面生成失败")

@app.get("/api/cover/themes")
async def api_cover_themes(request: Request):
    """获取可用的封面主题列表"""
    require_auth(request)
    return {"themes": list(THEME_COLORS.keys())}

@app.get("/api/playlists")
async def api_playlists(request: Request):
    require_auth(request)
    playlists = navidrome.get_playlists()
    return {"playlists": playlists}

@app.post("/api/library/refresh")
async def api_refresh_library(request: Request):
    require_auth(request)
    _refresh_library()
    return {"status": "ok", "count": len(library_cache.get("songs", []))}


# ==================== 辅助函数 ====================
import re

def _get_library():
    """获取歌曲库（带缓存）"""
    now = time.time()
    if now - library_cache.get("last_update", 0) > CACHE_TTL:
        _refresh_library()
    return library_cache.get("songs", [])

def _refresh_library():
    """刷新歌曲库（后台线程）"""
    if library_cache.get("loading"):
        return
    library_cache["loading"] = True
    def _do_refresh():
        try:
            logger.info("正在刷新歌曲库...")
            songs = navidrome.get_all_songs()
            library_cache["songs"] = songs
            library_cache["last_update"] = time.time()
            logger.info(f"歌曲库已更新: {len(songs)} 首歌曲")
        except Exception as e:
            logger.error(f"刷新歌曲库失败: {e}")
        finally:
            library_cache["loading"] = False
    threading.Thread(target=_do_refresh, daemon=True).start()


# ==================== 启动 ====================
if __name__ == "__main__":
    import uvicorn
    # 启动时在后台预加载歌曲库
    try:
        logger.info(f"正在连接 Navidrome: {config.NAVIDROME_URL}")
        if navidrome.ping():
            logger.info("Navidrome 连接成功！正在后台加载歌曲库...")
            _refresh_library()
        else:
            logger.warning("Navidrome 连接失败，将在首次请求时重试")
    except Exception as e:
        logger.error(f"启动时连接 Navidrome 失败: {e}")

    uvicorn.run(app, host=config.HOST, port=config.PORT)
