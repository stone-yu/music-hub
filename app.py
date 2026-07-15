"""
MusicHub - 音乐中枢：搜索、匹配、下载、刮削、歌单管理
"""
import os
import json
import time
import logging
import secrets
import threading
from typing import Optional
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, Response, HTTPException, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import requests

import config
from searchers import search_all, search_all_merged, Song, HEADERS
from app.navidrome_client import NavidromeClient, NavidromeSong
from app.cover_generator import generate_cover, THEME_COLORS
from app.playlist_parser import fetch_playlist_from_url, parse_playlist_url
from app.hot_playlists import fetch_all_hot, HOT_PLAYLIST_FETCHERS, fetch_netease_by_category, NETEASE_CATEGORIES
from app.playlist_search import search_all_playlists
from app.hot_songs import get_all_ranks, fetch_rank_songs, RANK_PROVIDERS
from app.downloader import download_manager, DOWNLOAD_SOURCES, kuwo_search_candidates, MAX_TASKS
from app.scraper import scrape_manager, METADATA_SOURCES as SCRAPE_SOURCES

# 日志配置
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="MusicHub")

# 模板和静态文件
BASE_DIR = Path(__file__).parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

# 会话存储（简单 token 方式）
active_sessions = {}

# Navidrome 客户端
navidrome = NavidromeClient(config.NAVIDROME_URL, config.NAVIDROME_USER, config.NAVIDROME_PASS)

# 歌曲库缓存（内存 + 磁盘持久化，避免重启后重新全量拉取）
LIBRARY_JSON = os.path.join(os.getenv('DATA_DIR', '/app/data'), 'library_cache.json')
library_cache = {"songs": [], "last_update": 0, "loading": False}
CACHE_TTL = 600  # 10分钟刷新一次
_library_lock = threading.Lock()


def _load_library_from_disk():
    """启动时从磁盘加载上次的曲库快照，命中即无需等待全量拉取"""
    try:
        if os.path.exists(LIBRARY_JSON):
            with open(LIBRARY_JSON, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get("songs"), list):
                library_cache["songs"] = [NavidromeSong(**s) for s in data["songs"] if isinstance(s, dict)]
                library_cache["last_update"] = data.get("last_update", 0)
                logger.info(f"从磁盘加载曲库快照: {len(library_cache['songs'])} 首歌曲 (快照时间 {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(data.get('last_update', 0)))})")
    except Exception as e:
        logger.warning(f"加载曲库快照失败: {e}")


def _save_library_to_disk():
    """把当前曲库缓存写入磁盘（在 _refresh_library 成功后调用）"""
    try:
        os.makedirs(os.path.dirname(LIBRARY_JSON), exist_ok=True)
        with _library_lock:
            songs = [{"id": s.id, "title": s.title, "artist": s.artist, "album": s.album} for s in library_cache["songs"]]
            payload = {"songs": songs, "last_update": library_cache["last_update"]}
        tmp = LIBRARY_JSON + ".tmp"
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, LIBRARY_JSON)
    except Exception as e:
        logger.warning(f"保存曲库快照失败: {e}")


# 启动时优先加载磁盘快照
_load_library_from_disk()

# 聚合接口缓存：外部音乐接口(网易云/酷狗/QQ)慢变，列表类结果短 TTL 缓存，
# 避免每次切页都重新串行抓取。key=接口路径，value=(过期时间戳, 数据)。
_api_cache = {}
_api_cache_lock = threading.Lock()
HOT_API_TTL = 60  # 榜单/热门歌单 60s


def _cache_get(key):
    """返回缓存数据(未过期)或 None"""
    with _api_cache_lock:
        item = _api_cache.get(key)
        if item and item[0] > time.time():
            return item[1]
        if item:
            _api_cache.pop(key, None)  # 过期清理
    return None


def _cache_set(key, value, ttl=HOT_API_TTL):
    with _api_cache_lock:
        _api_cache[key] = (time.time() + ttl, value)


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
def _render_app(request: Request, active: str = "home"):
    """统一渲染主应用页，active 标识当前页（高亮菜单、决定渲染哪个视图）"""
    return templates.TemplateResponse("app.html", {"request": request, "active": active})

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    if is_authenticated(request):
        return RedirectResponse(url="/home")
    return RedirectResponse(url="/login")

@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request, error: str = ""):
    return templates.TemplateResponse("login.html", {"request": request, "error": error})

@app.post("/login")
def do_login(request: Request, password: str = Form(...)):
    if password == config.LOGIN_PASSWORD:
        token = secrets.token_hex(32)
        active_sessions[token] = time.time()
        response = RedirectResponse(url="/home", status_code=302)
        response.set_cookie("session_token", token, httponly=True, max_age=86400)
        return response
    return templates.TemplateResponse("login.html", {
        "request": request,
        "error": "密码错误，请重试"
    })

def _require_login(request: Request):
    """页面路由用：未登录跳登录页"""
    if not is_authenticated(request):
        return RedirectResponse(url="/login")
    return None

@app.get("/home", response_class=HTMLResponse)
def page_home(request: Request):
    r = _require_login(request);
    if r: return r
    return _render_app(request, "home")

@app.get("/hot-songs", response_class=HTMLResponse)
def page_hot_songs(request: Request):
    r = _require_login(request)
    if r: return r
    return _render_app(request, "hot-songs")

@app.get("/hot-playlists", response_class=HTMLResponse)
def page_hot_playlists(request: Request):
    r = _require_login(request)
    if r: return r
    return _render_app(request, "hot-playlists")

@app.get("/search", response_class=HTMLResponse)
def page_search(request: Request):
    r = _require_login(request)
    if r: return r
    return _render_app(request, "search")

@app.get("/import", response_class=HTMLResponse)
def page_import(request: Request):
    r = _require_login(request)
    if r: return r
    return _render_app(request, "import")

@app.get("/mine", response_class=HTMLResponse)
def page_mine(request: Request):
    r = _require_login(request)
    if r: return r
    return _render_app(request, "mine")

@app.get("/settings", response_class=HTMLResponse)
def page_settings(request: Request):
    r = _require_login(request)
    if r: return r
    return _render_app(request, "settings")

@app.get("/playlist", response_class=HTMLResponse)
def page_playlist(request: Request):
    """歌单详情页：query 参数 url= 或 source=&rank_id= 标识来源"""
    r = _require_login(request)
    if r: return r
    return _render_app(request, "detail")

@app.get("/app", response_class=HTMLResponse)
def app_page_legacy(request: Request):
    """旧链接兼容，重定向到首页"""
    if not is_authenticated(request):
        return RedirectResponse(url="/login")
    return RedirectResponse(url="/home")

@app.get("/logout")
def logout(request: Request):
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
    cover_url: str = ""  # 原歌单封面URL（优先于自动生成）

class MatchRequest(BaseModel):
    query: str
    sources: list = []

class PlaylistUrlRequest(BaseModel):
    url: str

@app.get("/api/status")
def api_status(request: Request):
    require_auth(request)
    connected = navidrome.ping()
    return {
        "navidrome_connected": connected,
        "library_size": len(library_cache.get("songs", [])),
        "library_loading": library_cache.get("loading", False),
        # 曲库是否曾经成功加载过（依据持久化的 last_update）。前端据此判断是否首次启动、
        # 是否需要弹出"曲库初始化中"提示：只有从未加载过才提示，避免每次重启都弹。
        "library_ever_loaded": library_cache.get("last_update", 0) > 0,
    }

@app.post("/api/search")
def api_search(req: SearchRequest, request: Request):
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
def api_match(req: MatchRequest, request: Request):
    require_auth(request)
    if not req.query.strip():
        raise HTTPException(400, "搜索关键词不能为空")

    # 1. 从各平台搜索
    logger.info(f"匹配搜索: {req.query}")
    from searchers import ALL_SEARCHERS
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
    matched, unmatched = _match_songs(unique_songs)

    return {
        "query": req.query,
        "source_stats": source_stats,
        "search_total": len(unique_songs),
        "matched": matched,
        "matched_count": len(matched),
        "unmatched": unmatched[:50],
        "unmatched_count": len(unmatched),
    }

@app.post("/api/playlist/from-url")
def api_playlist_from_url(req: PlaylistUrlRequest, request: Request):
    """从歌单链接获取歌曲并匹配曲库"""
    require_auth(request)
    if not req.url.strip():
        raise HTTPException(400, "链接不能为空")

    logger.info(f"解析歌单链接: {req.url}")

    # 1. 从URL获取歌单歌曲
    try:
        playlist_name, url_songs = fetch_playlist_from_url(req.url)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"获取歌单失败: {e}")
        raise HTTPException(500, f"获取歌单失败: {e}")

    if not url_songs:
        raise HTTPException(400, "未能从该链接获取到歌曲")

    # 2. 去重
    seen = set()
    unique_songs = []
    for song in url_songs:
        key = song.match_key
        if key not in seen:
            seen.add(key)
            unique_songs.append(song)

    # 3. 与 Navidrome 库匹配
    matched, unmatched = _match_songs(unique_songs)

    return {
        "playlist_name": playlist_name,
        "source": url_songs[0].source if url_songs else "unknown",
        "search_total": len(unique_songs),
        "matched": matched,
        "matched_count": len(matched),
        "unmatched": unmatched[:50],
        "unmatched_count": len(unmatched),
    }


class PlaylistSearchRequest(BaseModel):
    query: str
    sources: list = []


@app.post("/api/playlist/search")
def api_playlist_search(req: PlaylistSearchRequest, request: Request):
    """按关键词搜各平台歌单，返回歌单列表(含规范 url，点击走 /api/playlist/from-url 导入)"""
    require_auth(request)
    if not req.query.strip():
        raise HTTPException(400, "搜索关键词不能为空")
    grouped = search_all_playlists(req.query, req.sources or None)
    return {
        "playlists": {name: [p.to_dict() for p in items] for name, items in grouped.items()}
    }


@app.post("/api/playlist/create")
def api_create_playlist(req: CreatePlaylistRequest, request: Request):
    require_auth(request)
    if not req.name.strip():
        raise HTTPException(400, "歌单名称不能为空")
    if not req.song_ids:
        raise HTTPException(400, "歌曲列表不能为空")

    logger.info(f"创建歌单: {req.name}, 歌曲数: {len(req.song_ids)}, 封面: {req.cover_enabled}")

    # 封面：优先使用原歌单封面URL，其次自动生成
    cover_data = None
    cover_used = False
    if req.cover_url.strip():
        try:
            from urllib.parse import urlparse
            cu = req.cover_url.strip()
            host = urlparse(cu).hostname or ""
            if any(host == h or host.endswith("." + h) for h in _COVER_HOST_WHITELIST):
                resp = requests.get(cu, headers={**HEADERS, 'Referer': f'{urlparse(cu).scheme}://{host}/'},
                                    timeout=15, verify=False)
                resp.raise_for_status()
                cover_data = resp.content
                cover_used = len(cover_data) > 0
                logger.info(f"使用原歌单封面: {len(cover_data)} bytes")
        except Exception as e:
            logger.warning(f"获取原歌单封面失败: {e}")
    if not cover_data and req.cover_enabled:
        try:
            theme = req.cover_theme if req.cover_theme else None
            subtitle = f"{len(req.song_ids)} 首歌曲 · AI 生成"
            cover_data = generate_cover(req.name, subtitle=subtitle, theme=theme)
            cover_used = True
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
            "cover_generated": cover_used,
        }
    else:
        raise HTTPException(500, "创建歌单失败")

class AddToPlaylistRequest(BaseModel):
    playlist_id: str
    song_ids: list

@app.post("/api/playlist/add")
def api_add_to_playlist(req: AddToPlaylistRequest, request: Request):
    """将歌曲加入已有 Navidrome 歌单，自动去重"""
    require_auth(request)
    if not req.song_ids:
        raise HTTPException(400, "歌曲列表不能为空")
    result = navidrome.add_to_playlist(req.playlist_id, req.song_ids)
    return {"success": True, **result}

class DownloadRequest(BaseModel):
    title: str
    artist: str

class DownloadStatusRequest(BaseModel):
    songs: list  # [{title, artist}]

@app.post("/api/download")
def api_download(req: DownloadRequest, request: Request):
    """下载一首未匹配的歌曲到 DOWNLOAD_DIR（后台执行）"""
    require_auth(request)
    if not req.title.strip():
        raise HTTPException(400, "歌曲名不能为空")
    if download_manager.count() >= MAX_TASKS:
        raise HTTPException(400, f"下载任务已达上限 {MAX_TASKS} 个，请先清理历史任务")
    task = download_manager.submit(req.title.strip(), req.artist.strip(),
                                   config.DOWNLOAD_SOURCE, config.DOWNLOAD_DIR)
    return {"status": task.get('status', 'downloading'), "title": req.title, "artist": req.artist}

class DownloadByRidRequest(BaseModel):
    title: str
    artist: str
    rid: str
    quality: str = "standard"   # standard(128k) / high(320k) / lossless(flac)

@app.post("/api/download/by-rid")
def api_download_by_rid(req: DownloadByRidRequest, request: Request):
    """用户从候选列表选定 rid 后下载"""
    require_auth(request)
    if not req.rid.strip():
        raise HTTPException(400, "rid 不能为空")
    if download_manager.count() >= MAX_TASKS:
        raise HTTPException(400, f"下载任务已达上限 {MAX_TASKS} 个，请先清理历史任务")
    task = download_manager.submit_by_rid(req.title.strip(), req.artist.strip(),
                                          req.rid.strip(), config.DOWNLOAD_SOURCE,
                                          config.DOWNLOAD_DIR, req.quality.strip())
    return {"status": task.get('status', 'downloading'), "title": req.title, "artist": req.artist}

@app.get("/api/download/search")
def api_download_search(request: Request, keyword: str = ""):
    """搜索下载候选列表（含大小，用于前端选择）"""
    require_auth(request)
    if not keyword.strip():
        raise HTTPException(400, "关键词不能为空")
    candidates = kuwo_search_candidates(keyword.strip(), limit=8)
    return {"candidates": candidates}

@app.get("/api/download/preview")
def api_download_preview(request: Request, rid: str = ""):
    """试听代理：转发酷我音频流（带 Referer，支持 Range 分段播放）"""
    require_auth(request)
    if not rid.strip():
        raise HTTPException(400, "rid 不能为空")
    from app.downloader import kuwo_get_url
    url = kuwo_get_url(rid.strip())
    if not url:
        raise HTTPException(404, "获取试听URL失败")
    # 转发客户端的 Range 请求头
    fwd_headers = {**HEADERS}
    range_header = request.headers.get('range')
    if range_header:
        fwd_headers['Range'] = range_header
    try:
        resp = requests.get(url, headers=fwd_headers, timeout=30, stream=True)
        # 透传音频流和 Content-Type / Content-Range / Content-Length
        excluded = {'content-encoding', 'transfer-encoding', 'connection'}
        headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
        return Response(content=resp.content, status_code=resp.status_code,
                        headers=headers, media_type=resp.headers.get('Content-Type', 'audio/mpeg'))
    except Exception as e:
        logger.warning(f"试听代理失败: {e}")
        raise HTTPException(502, "试听失败")

@app.get("/api/download/play")
def api_download_play(request: Request, title: str = "", artist: str = ""):
    """试听本地文件：优先刮削后路径，其次下载文件路径（支持 Range）"""
    require_auth(request)
    if not title.strip():
        raise HTTPException(400, "title 不能为空")
    task = download_manager.get_status(title.strip(), artist.strip())
    filepath = ''
    if isinstance(task, dict):
        filepath = task.get('scrape_path') or task.get('filepath') or ''
    if not filepath or not os.path.exists(filepath):
        raise HTTPException(404, "文件不存在或未下载完成")
    # 支持 Range 分段播放
    range_header = request.headers.get('range', '')
    file_size = os.path.getsize(filepath)
    if range_header:
        start, end = 0, file_size - 1
        m = re.search(r'bytes=(\d+)-(\d*)', range_header)
        if m:
            start = int(m.group(1))
            if m.group(2):
                end = int(m.group(2))
        length = end - start + 1
        with open(filepath, 'rb') as f:
            f.seek(start)
            data = f.read(length)
        return Response(content=data, status_code=206,
                        headers={'Content-Range': f'bytes {start}-{end}/{file_size}',
                                 'Accept-Ranges': 'bytes', 'Content-Length': str(length)},
                        media_type='audio/mpeg')
    with open(filepath, 'rb') as f:
        data = f.read()
    return Response(content=data, media_type='audio/mpeg',
                    headers={'Accept-Ranges': 'bytes', 'Content-Length': str(file_size)})

@app.post("/api/download/status")
def api_download_status(req: DownloadStatusRequest, request: Request):
    """批量查询下载状态"""
    require_auth(request)
    return {"statuses": download_manager.get_all_status(req.songs or [])}

@app.get("/api/download/sources")
def api_download_sources(request: Request):
    """可用下载源"""
    require_auth(request)
    return {"sources": list(DOWNLOAD_SOURCES.keys()), "current": config.DOWNLOAD_SOURCE,
            "download_dir": config.DOWNLOAD_DIR}

@app.get("/api/download/tasks")
def api_download_tasks(request: Request):
    """获取所有下载任务列表（合并刮削状态，供展开弹框展示）"""
    require_auth(request)
    tasks = download_manager.list_all()
    # 合并刮削状态
    if tasks:
        songs = [{"title": t["title"], "artist": t["artist"]} for t in tasks]
        scrape_statuses = {f"{s['title']}|{s['artist']}": s
                           for s in scrape_manager.get_all_status(songs)}
        for t in tasks:
            key = f"{t['title']}|{t['artist']}"
            ss = scrape_statuses.get(key, {})
            t["scrape_status"] = ss.get("scrape_status", ss.get("status", "idle"))
            t["organize_status"] = ss.get("organize_status", "idle")
            t["scrape_album"] = ss.get("album", "")
            t["scrape_path"] = ss.get("scraped_path", "")
    return {"tasks": tasks}

class DownloadRemoveRequest(BaseModel):
    title: str
    artist: str
    delete_file: bool = False

@app.post("/api/download/remove")
def api_download_remove(req: DownloadRemoveRequest, request: Request):
    """删除一个下载任务记录，可选删除已下载文件"""
    require_auth(request)
    ok = download_manager.remove(req.title.strip(), req.artist.strip(), req.delete_file)
    return {"success": ok}

class ScrapeRequest(BaseModel):
    title: str
    artist: str
    filepath: str = ""

class ScrapeBatchRequest(BaseModel):
    tasks: list  # [{title, artist, filepath}]

class ScrapeStatusRequest(BaseModel):
    songs: list  # [{title, artist}]

@app.post("/api/download/scrape")
def api_scrape(req: ScrapeRequest, request: Request):
    """触发单首歌曲刮削（后台执行：搜元数据→写标签→整理）"""
    require_auth(request)
    if not req.title.strip():
        raise HTTPException(400, "歌曲名不能为空")
    # filepath 未传则从下载任务查
    filepath = req.filepath.strip()
    if not filepath:
        task = download_manager.get_status(req.title.strip(), req.artist.strip())
        filepath = task.get('filepath', '') if isinstance(task, dict) else ''
    if not filepath:
        raise HTTPException(400, "找不到文件路径，请先下载")
    task = scrape_manager.submit(req.title.strip(), req.artist.strip(), filepath, config.SCRAPED_DIR)
    return {"status": task.get('status', 'scraping'), "title": req.title, "artist": req.artist}

@app.post("/api/download/scrape/batch")
def api_scrape_batch(req: ScrapeBatchRequest, request: Request):
    """批量刮削"""
    require_auth(request)
    submitted = 0
    for t in (req.tasks or []):
        title = t.get('title', '').strip()
        artist = t.get('artist', '').strip()
        filepath = t.get('filepath', '').strip()
        if not title:
            continue
        if not filepath:
            task = download_manager.get_status(title, artist)
            filepath = task.get('filepath', '') if isinstance(task, dict) else ''
        if filepath:
            scrape_manager.submit(title, artist, filepath, config.SCRAPED_DIR)
            submitted += 1
    return {"submitted": submitted}

@app.post("/api/download/scrape/status")
def api_scrape_status(req: ScrapeStatusRequest, request: Request):
    """批量查询刮削状态"""
    require_auth(request)
    return {"statuses": scrape_manager.get_all_status(req.songs or [])}

@app.get("/api/download/scrape/sources")
def api_scrape_sources(request: Request):
    """可用刮削数据源"""
    require_auth(request)
    return {"sources": list(SCRAPE_SOURCES.keys()), "scraped_dir": config.SCRAPED_DIR}

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
def api_cover_themes(request: Request):
    """获取可用的封面主题列表"""
    require_auth(request)
    return {"themes": list(THEME_COLORS.keys())}

@app.get("/api/playlists")
def api_playlists(request: Request):
    require_auth(request)
    playlists = navidrome.get_playlists()
    return {"playlists": playlists}

@app.get("/api/playlists/{playlist_id}/songs")
def api_playlist_songs(playlist_id: str, request: Request):
    """获取某 Navidrome 歌单内的歌曲（只读查看）"""
    require_auth(request)
    songs = navidrome.get_playlist_songs(playlist_id)
    return {"songs": [s.__dict__ for s in songs]}

@app.get("/api/cover/navidrome/{cover_id}")
def api_navidrome_cover(cover_id: str, request: Request):
    """代理 Navidrome 歌单封面（需要 Subsonic 认证，前端无法直接拼 URL）"""
    require_auth(request)
    data = navidrome.get_cover_art(cover_id)
    if not data:
        raise HTTPException(404, "封面不存在")
    return Response(content=data, media_type="image/jpeg")

@app.get("/api/hot-playlists")
def api_hot_playlists(request: Request, refresh: str = ""):
    """获取各平台热门歌单列表，点击后用其中的 url 走 /api/playlist/from-url 导入"""
    require_auth(request)
    if refresh:
        _api_cache.pop('hot_playlists', None)
    else:
        cached = _cache_get('hot_playlists')
        if cached is not None:
            return cached
    grouped = fetch_all_hot()
    data = {
        "playlists": {
            name: [p.to_dict() for p in items]
            for name, items in grouped.items()
        }
    }
    # 完整性校验：平台数不达标(有平台抓取失败)则不缓存，下次自动重试
    if sum(1 for v in data["playlists"].values() if v) >= len(HOT_PLAYLIST_FETCHERS):
        _cache_set('hot_playlists', data)
    return data

@app.get("/api/playlist/categories")
def api_playlist_categories(request: Request):
    """返回各平台可用的歌单分类标签。仅网易云有官方分类浏览接口，
    其他平台(酷狗/QQ/酷我)无稳定分类页，只有"热门"。"""
    require_auth(request)
    return {"categories": {"网易云": [c[0] for c in NETEASE_CATEGORIES]}}


@app.get("/api/playlist/by-category")
def api_playlist_by_category(request: Request, source: str = "", cat: str = ""):
    """按平台+分类拉歌单。目前仅网易云支持分类；其他平台忽略 cat 返回热门。"""
    require_auth(request)
    source = source.strip()
    cat = cat.strip()
    if source == '网易云':
        items = fetch_netease_by_category(cat or '热门')
        return {"playlists": [p.to_dict() for p in items]}
    # 非网易平台：无分类接口，回退热门
    grouped = fetch_all_hot(sources=[source] if source else None)
    items = grouped.get(source, []) if source else []
    return {"playlists": [p.to_dict() for p in items]}


@app.get("/api/ranks")
def api_ranks(request: Request, refresh: str = ""):
    """获取各平台排行榜列表，按平台分组"""
    require_auth(request)
    if refresh:
        _api_cache.pop('ranks', None)
    else:
        cached = _cache_get('ranks')
        if cached is not None:
            return cached
    data = {"ranks": get_all_ranks()}
    if sum(1 for v in data["ranks"].values() if v) >= len(RANK_PROVIDERS):
        _cache_set('ranks', data)
    return data

@app.get("/api/rank/songs")
def api_rank_songs(request: Request, source: str = "", rank_id: str = "", limit: int = 100):
    """取某平台某榜单的歌曲，并标注每首是否已在曲库"""
    require_auth(request)
    if not source or not rank_id:
        raise HTTPException(400, "缺少 source 或 rank_id")
    songs = fetch_rank_songs(source, rank_id, limit)
    annotated = _annotate_songs(songs)
    return {
        "source": source,
        "rank_id": rank_id,
        "total": len(annotated),
        "songs": annotated,
    }

def _build_home_songs_source(source):
    """取某平台第一个榜单的前5首。返回原始歌曲 list(不含曲库匹配)。"""
    try:
        ranks = RANK_PROVIDERS[source]["ranks"]()
        if ranks:
            songs = fetch_rank_songs(source, ranks[0].id, 5)
            return [{"title": s.title, "artist": s.artist, "album": s.album, "source": s.source} for s in songs]
    except Exception as e:
        logger.error(f"首页[{source}]榜单失败: {e}")
    return []


def _annotate_home_songs(raw):
    """对缓存的原始歌曲按当前曲库实时匹配，返回带 in_library 的结果。"""
    result = {}
    for source, items in raw.items():
        songs = [Song(title=i["title"], artist=i["artist"], album=i.get("album", ""), source=i.get("source", "")) for i in items]
        result[source] = _annotate_songs(songs)
    return result


def _build_home_playlists_source(name):
    """取某平台 top5 热门歌单"""
    for pname, fetcher in HOT_PLAYLIST_FETCHERS:
        if pname == name:
            try:
                return [p.to_dict() for p in fetcher(5)]
            except Exception as e:
                logger.error(f"[{name}] 获取热门歌单失败: {e}")
                return []
    return []


@app.get("/api/home")
def api_home(request: Request, refresh: str = "", song_platforms: str = "", playlist_platforms: str = ""):
    """首页聚合：各平台 top5 热门歌曲 + top5 热门歌单。
    song_platforms/playlist_platforms: 逗号分隔的平台名，只请求这些平台(为空则取全部已注册平台)。
    refresh: songs|playlists|all，强制刷新对应部分并清其缓存。
    注：按平台独立缓存外部抓取的原始数据；曲库匹配(in_library)每次请求按当前曲库实时计算，不缓存。"""
    require_auth(request)
    def parse(s, all_names):
        ps = [x.strip() for x in s.split(',') if x.strip()]
        return [p for p in ps if p in all_names] or list(all_names)
    song_sources = parse(song_platforms, RANK_PROVIDERS.keys())
    playlist_sources = parse(playlist_platforms, [n for n, _ in HOT_PLAYLIST_FETCHERS])

    # 热门歌曲：按平台独立缓存
    raw_songs = {}
    for source in song_sources:
        key = f'home_songs:{source}'
        if refresh in ('songs', 'all'):
            _api_cache.pop(key, None)
        cached = _cache_get(key)
        if cached is not None:
            raw_songs[source] = cached
        else:
            data = _build_home_songs_source(source)
            if data:  # 只缓存非空结果，失败不缓存以便下次重试
                _cache_set(key, data)
            raw_songs[source] = data
    top_songs = _annotate_home_songs(raw_songs)

    # 热门歌单：按平台独立缓存
    top_playlists = {}
    for name in playlist_sources:
        key = f'home_playlists:{name}'
        if refresh in ('playlists', 'all'):
            _api_cache.pop(key, None)
        cached = _cache_get(key)
        if cached is not None:
            top_playlists[name] = cached
        else:
            data = _build_home_playlists_source(name)
            if data:
                _cache_set(key, data)
            top_playlists[name] = data
    return {"top_songs": top_songs, "top_playlists": top_playlists}

# 允许代理的封面图域名白名单，避免被当作开放 SSRF
_COVER_HOST_WHITELIST = (
    'music.126.net',      # 网易云封面 CDN
    'qpic.y.qq.com',      # QQ音乐封面
    'p.qpic.cn',          # QQ音乐封面 CDN（搜索结果）
    'y.gtimg.cn',
    'mobilecdn.kugou.com',
    'imgessl.kugou.com',  # 酷狗封面 CDN
    'imge.kugou.com',     # 酷狗封面 CDN（备用域名）
    'kuwo.cn',
    'kwcdn.kuwo.cn',      # 酷我封面 CDN
    'img1.kuwo.cn',       # 酷我封面 CDN（备用域名）
)

@app.get("/api/home/platforms")
def api_home_platforms(request: Request):
    """返回首页可用的歌曲平台与歌单平台列表(供设置页勾选)"""
    require_auth(request)
    return {
        "song_platforms": list(RANK_PROVIDERS.keys()),
        "playlist_platforms": [name for name, _ in HOT_PLAYLIST_FETCHERS],
    }


@app.get("/api/cover/proxy")
def api_cover_proxy(request: Request, url: str = ""):
    """代理封面图：规避热链 Referer 限制与 http/https 混合内容问题"""
    require_auth(request)
    url = (url or "").strip()
    if not url:
        raise HTTPException(400, "缺少 url 参数")
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "仅支持 http/https 链接")
    from urllib.parse import urlparse
    host = urlparse(url).hostname or ""
    if not any(host == h or host.endswith("." + h) for h in _COVER_HOST_WHITELIST):
        raise HTTPException(403, "该图片域名不在允许列表内")
    try:
        resp = requests.get(url, headers={**HEADERS, 'Referer': f'{urlparse(url).scheme}://{host}/'},
                            timeout=15, verify=False)
        resp.raise_for_status()
        content_type = resp.headers.get('Content-Type', 'image/jpeg')
        return Response(content=resp.content, media_type=content_type)
    except Exception as e:
        logger.warning(f"封面代理失败 {url}: {e}")
        raise HTTPException(502, "封面获取失败")

@app.post("/api/library/refresh")
def api_refresh_library(request: Request):
    require_auth(request)
    _refresh_library(scan_first=True)
    return {"status": "ok", "scanning": library_cache.get("loading", False)}


# ==================== 辅助函数 ====================
import re

def _get_library():
    """获取歌曲库（带缓存）"""
    now = time.time()
    if now - library_cache.get("last_update", 0) > CACHE_TTL:
        _refresh_library()
    return library_cache.get("songs", [])

def _lib_index():
    """构建曲库 match_key 索引"""
    idx = {}
    for ls in _get_library():
        k = ls.match_key
        if k not in idx:
            idx[k] = ls
    return idx

def _match_one(song, lib_index):
    """单首歌与曲库匹配，返回 (matched_dict|None, is_fuzzy)"""
    key = song.match_key
    if key in lib_index:
        ns = lib_index[key]
        return {"title": ns.title, "artist": ns.artist, "album": ns.album,
                "id": ns.id, "source": song.source}, False
    # 模糊匹配
    title_clean = re.sub(r'[\s\-\(\)（）]', '', song.title.lower())
    if title_clean and len(title_clean) >= 2:
        for ls in lib_index.values():
            lib_title = re.sub(r'[\s\-\(\)（）]', '', ls.title.lower())
            if lib_title and (title_clean in lib_title or lib_title in title_clean):
                return {"title": ls.title, "artist": ls.artist, "album": ls.album,
                        "id": ls.id, "source": f"{song.source}(模糊)"}, True
    return None, False

def _match_songs(songs):
    """将一批 Song 与曲库匹配，返回 (matched, unmatched)。
    按 lib_id 去重：同一首库内歌曲只保留首次匹配，避免多平台/多搜索结果重复。"""
    lib_index = _lib_index()
    matched, unmatched = [], []
    seen_lib_ids = set()
    for song in songs:
        m, _ = _match_one(song, lib_index)
        if m:
            if m["id"] in seen_lib_ids:
                continue  # 同一首库歌已匹配过，跳过
            seen_lib_ids.add(m["id"])
            matched.append(m)
        else:
            unmatched.append({"title": song.title, "artist": song.artist, "source": song.source})
    return matched, unmatched

def _annotate_songs(songs):
    """给一批 Song 标注曲库匹配状态，保留原始顺序，返回 dict 列表（含 in_library 字段）。
    未在库的歌曲保留全部；已匹配的按 lib_id 去重，同一首库歌只标一次。"""
    lib_index = _lib_index()
    result = []
    seen_lib_ids = set()
    for song in songs:
        m, _ = _match_one(song, lib_index)
        item = {"title": song.title, "artist": song.artist, "album": song.album, "source": song.source}
        if m:
            if m["id"] in seen_lib_ids:
                # 同一首库歌已出现过，标为未收录避免重复展示
                item["in_library"] = False
                result.append(item)
                continue
            seen_lib_ids.add(m["id"])
            item["in_library"] = True
            item["lib_id"] = m["id"]
            item["lib_title"] = m["title"]
            item["lib_artist"] = m["artist"]
            item["fuzzy"] = "(模糊)" in m["source"]
        else:
            item["in_library"] = False
        result.append(item)
    return result

def _refresh_library(scan_first=False):
    """刷新歌曲库（后台线程）。scan_first=True 时先触发 Navidrome 扫描文件夹，扫描完成后再重载缓存。"""
    if library_cache.get("loading"):
        return
    library_cache["loading"] = True
    def _do_refresh():
        try:
            if scan_first:
                try:
                    logger.info("触发 Navidrome 扫描...")
                    navidrome.start_scan()
                    # 轮询扫描状态，最多等 120 秒
                    for _ in range(120):
                        time.sleep(1)
                        st = navidrome.get_scan_status()
                        if not st or not st.get("scanning"):
                            break
                    logger.info("Navidrome 扫描完成，开始重载缓存")
                except Exception as e:
                    logger.warning(f"触发扫描失败，直接重载缓存: {e}")
            logger.info("正在刷新歌曲库...")
            songs = navidrome.get_all_songs()
            with _library_lock:
                library_cache["songs"] = songs
                library_cache["last_update"] = time.time()
            _save_library_to_disk()
            logger.info(f"歌曲库已更新: {len(songs)} 首歌曲")
        except Exception as e:
            logger.error(f"刷新歌曲库失败: {e}")
        finally:
            library_cache["loading"] = False
    threading.Thread(target=_do_refresh, daemon=True).start()


# 刮削完成后触发曲库刷新（scan_first=True 先扫描再重载）。
# _refresh_library 内部有 loading 守卫：若已有刷新在进行中则直接返回，不重复触发。
scrape_manager.on_scrape_complete = lambda: _refresh_library(scan_first=True)


# ==================== 启动 ====================
if __name__ == "__main__":
    import uvicorn
    # 启动时在后台预加载歌曲库（有磁盘快照且未过期则跳过立即刷新）
    try:
        logger.info(f"正在连接 Navidrome: {config.NAVIDROME_URL}")
        if navidrome.ping():
            snapshot_fresh = (time.time() - library_cache.get("last_update", 0)) < CACHE_TTL
            if snapshot_fresh and library_cache.get("songs"):
                logger.info("Navidrome 连接成功，曲库快照未过期，跳过立即刷新")
            else:
                logger.info("Navidrome 连接成功！正在后台加载歌曲库...")
                _refresh_library()
        else:
            logger.warning("Navidrome 连接失败，将在首次请求时重试")
    except Exception as e:
        logger.error(f"启动时连接 Navidrome 失败: {e}")

    uvicorn.run(app, host=config.HOST, port=config.PORT)
