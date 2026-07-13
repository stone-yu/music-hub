"""
轻量级音乐下载器 - 各平台搜索并下载音频文件到本地目录
当前实现：酷我音乐（无需加密、无需FFmpeg）
架构采用注册表模式，后续可逐步添加其他平台的轻量下载实现。

注意：各平台接口为非官方逆向，可能随时失效。下载内容仅供个人学习使用。
"""
import os
import re
import json
import time
import logging
import threading
from dataclasses import dataclass, asdict
from typing import List, Optional, Dict

import requests

logger = logging.getLogger(__name__)

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}


@dataclass
class DownloadResult:
    title: str
    artist: str
    source: str
    status: str          # success | failed | downloading | notfound
    filepath: str = ""
    error: str = ""

    def to_dict(self):
        return asdict(self)


def _safe_filename(name: str) -> str:
    """清理文件名中的非法字符"""
    name = re.sub(r'[\\/:*?"<>|]', '', name).strip()
    name = re.sub(r'\s+', ' ', name)
    return name[:100] if name else 'unknown'


# ==================== 酷我音乐 ====================
def kuwo_search(keyword: str, limit: int = 10) -> List[dict]:
    """酷我搜索，返回 [{rid, title, artist}]"""
    songs = []
    try:
        resp = requests.get(
            'http://search.kuwo.cn/r.s',
            params={'all': keyword, 'ft': 'music', 'rformat': 'json',
                    'encoding': 'utf8', 'pn': 0, 'rn': limit},
            headers=HEADERS, timeout=10,
        )
        # 酷我返回单引号伪 JSON
        text = resp.text.replace("'", '"')
        data = json.loads(text)
        for item in data.get('abslist', []):
            rid = str(item.get('MUSICRID', '')).replace('MUSIC_', '')
            if not rid:
                continue
            title = item.get('SONGNAME', '').replace('&nbsp;', ' ').strip()
            artist = item.get('ARTIST', '').replace('&nbsp;', ' ').strip()
            if title and artist:
                songs.append({'rid': rid, 'title': title, 'artist': artist})
    except Exception as e:
        logger.warning(f"酷我搜索失败: {e}")
    return songs


def kuwo_get_url(rid: str) -> Optional[str]:
    """酷我 rid → mp3 播放URL"""
    try:
        resp = requests.get(
            'http://antiserver.kuwo.cn/anti.s',
            params={'type': 'convert_url', 'format': 'mp3', 'response': 'url',
                    'rid': f'MUSIC_{rid}'},
            headers=HEADERS, timeout=10,
        )
        url = resp.text.strip()
        if url.startswith('http'):
            return url
    except Exception as e:
        logger.warning(f"酷我获取URL失败: {e}")
    return None


def kuwo_search_candidates(keyword: str, limit: int = 8) -> List[dict]:
    """搜索并返回候选列表，含每首歌的下载大小（用于前端选择）。
    过滤标题含「片段/伴奏/demo/铃声」的结果。返回 [{rid,title,artist,size_mb}]"""
    results = kuwo_search(keyword, limit=limit)
    candidates = []
    skip_words = ('片段', '伴奏', 'demo', '铃声', '试听', '剪版')
    for r in results:
        title_lower = r['title'].lower()
        if any(w in r['title'] or w in title_lower for w in skip_words):
            continue
        size = 0
        url = kuwo_get_url(r['rid'])
        if url:
            try:
                resp = requests.head(url, headers=HEADERS, timeout=8, allow_redirects=True)
                size = int(resp.headers.get('Content-Length', 0))
            except Exception:
                pass
        if not url or size == 0:
            continue
        candidates.append({'rid': r['rid'], 'title': r['title'], 'artist': r['artist'],
                           'source': '酷我', 'size': size, 'size_mb': round(size/1024/1024, 1)})
    return candidates


def kuwo_download_by_rid(rid: str, save_dir: str, title: str = '', artist: str = '') -> DownloadResult:
    """按 rid 下载（用户从候选列表选定后调用）。优先用 title/artist 命名文件"""
    url = kuwo_get_url(rid)
    if not url:
        return DownloadResult(title=title, artist=artist, source='酷我',
                              status='failed', error='获取下载URL失败')
    os.makedirs(save_dir, exist_ok=True)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=60, stream=True)
        resp.raise_for_status()
        # 文件名：优先用候选的 title/artist，否则从 Content-Disposition 解析，兜底 rid
        if title or artist:
            fname = f"{_safe_filename(title)} - {_safe_filename(artist)}.mp3"
        else:
            cd = resp.headers.get('Content-Disposition', '')
            fname = ''
            if cd:
                # 支持 filename="x" 和 filename*=UTF-8''x 两种格式
                m = re.search(r'filename\*=UTF-8\'\'([^";]+)', cd) or re.search(r'filename="([^";]+)"', cd)
                if m:
                    fname = m.group(1)
            if not fname:
                fname = f"{rid}.mp3"
        filepath = os.path.join(save_dir, _safe_filename(fname))
        # 避免重名覆盖：若已存在则加 rid 后缀
        if os.path.exists(filepath):
            base, ext = os.path.splitext(filepath)
            filepath = f"{base}_{rid}{ext}"
        with open(filepath, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        logger.info(f"下载成功: {fname} ({os.path.getsize(filepath)} bytes)")
        return DownloadResult(title=fname, artist='', source='酷我',
                              status='success', filepath=filepath)
    except Exception as e:
        logger.warning(f"下载失败 rid={rid}: {e}")
        return DownloadResult(title='', artist='', source='酷我',
                              status='failed', error=str(e))


def kuwo_download(title: str, artist: str, save_dir: str) -> DownloadResult:
    """搜索并下载一首歌（酷我源）。自动选首个非片段候选。"""
    keyword = f"{title} {artist}"
    candidates = kuwo_search_candidates(keyword, limit=8)
    if not candidates:
        return DownloadResult(title=title, artist=artist, source='酷我',
                              status='notfound', error='搜索无结果')
    # 选第一个候选（已过滤片段，且按搜索相关度排序）
    target = candidates[0]
    return kuwo_download_by_rid(target['rid'], save_dir, target['title'], target['artist'])


# ==================== 下载源注册表 ====================
# 后续新增平台：实现 download(title, artist, save_dir) -> DownloadResult 并注册
DOWNLOAD_SOURCES = {
    "酷我": kuwo_download,
}


# ==================== 下载管理器（JSON 持久化）====================
TASKS_JSON = os.path.join(os.getenv('DATA_DIR', '/app/data'), 'download_task.json')
MAX_TASKS = 100

class DownloadManager:
    """管理后台下载任务，JSON 持久化（上限100），维护状态供前端轮询"""
    def __init__(self):
        self._tasks: Dict[str, dict] = {}   # key → task信息
        self._lock = threading.Lock()
        self._load()

    def _load(self):
        """启动时从 JSON 加载历史任务，并把服务中断残留的 downloading 任务标记为 failed"""
        try:
            if os.path.exists(TASKS_JSON):
                with open(TASKS_JSON, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if isinstance(data, list):
                    dirty = False
                    for t in data:
                        key = self._key(t.get('title',''), t.get('artist',''))
                        # 服务重启会中断后台下载线程，残留的 downloading 状态需重置为失败，否则永久卡住
                        if t.get('status') == 'downloading':
                            t['status'] = 'failed'
                            t['error'] = '服务重启中断，请重试'
                            dirty = True
                        self._tasks[key] = t
                    logger.info(f"从 JSON 加载 {len(self._tasks)} 个下载任务")
                    if dirty:
                        self._save()
        except Exception as e:
            logger.warning(f"加载下载任务 JSON 失败: {e}")

    def _save(self):
        """保存任务到 JSON（调用方需持锁或在锁内调用后立即保存）"""
        try:
            os.makedirs(os.path.dirname(TASKS_JSON), exist_ok=True)
            tasks = list(self._tasks.values())
            with open(TASKS_JSON, 'w', encoding='utf-8') as f:
                json.dump(tasks, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning(f"保存下载任务 JSON 失败: {e}")

    def count(self) -> int:
        with self._lock:
            return len(self._tasks)

    def _key(self, title, artist):
        return f"{title}|{artist}"

    def submit(self, title: str, artist: str, source: str, save_dir: str) -> dict:
        """提交一个下载任务（后台线程执行）"""
        key = self._key(title, artist)
        with self._lock:
            # 已在下载中则跳过
            existing = self._tasks.get(key)
            if existing and existing.get('status') == 'downloading':
                return existing
            self._tasks[key] = {'title': title, 'artist': artist, 'source': source,
                                'status': 'downloading', 'filepath': '', 'error': '',
                                'updated': time.time()}
            self._save()
        def _do():
            res = None
            try:
                fn = DOWNLOAD_SOURCES.get(source)
                if not fn:
                    res = DownloadResult(title, artist, source, 'failed', error='不支持的平台')
                else:
                    res = fn(title, artist, save_dir)
            except Exception as e:
                logger.warning(f"下载异常 title={title} artist={artist}: {e}")
                res = DownloadResult(title, artist, source, 'failed', error=str(e))
            with self._lock:
                t = self._tasks.get(key, {})
                t.update({'status': res.status, 'filepath': res.filepath,
                          'error': res.error, 'updated': time.time()})
                self._save()
        threading.Thread(target=_do, daemon=True).start()
        return self._tasks[key]

    def submit_by_rid(self, title: str, artist: str, rid: str, source: str, save_dir: str) -> dict:
        """用户从候选列表选定 rid 后提交下载"""
        key = self._key(title, artist)
        with self._lock:
            self._tasks[key] = {'title': title, 'artist': artist, 'source': source, 'rid': rid,
                                'status': 'downloading', 'filepath': '', 'error': '',
                                'updated': time.time()}
            self._save()
        def _do():
            res = None
            try:
                res = kuwo_download_by_rid(rid, save_dir, title, artist)
            except Exception as e:
                logger.warning(f"下载异常 rid={rid} title={title}: {e}")
                res = DownloadResult(title, artist, source, 'failed', error=str(e))
            with self._lock:
                t = self._tasks.get(key, {})
                t.update({'status': res.status, 'filepath': res.filepath,
                          'error': res.error, 'updated': time.time()})
                self._save()
        threading.Thread(target=_do, daemon=True).start()
        return self._tasks[key]

    def update_scrape_path(self, title: str, artist: str, scrape_path: str):
        """刮削完成后回写整理后路径到下载任务（试听用）"""
        key = self._key(title, artist)
        with self._lock:
            t = self._tasks.get(key)
            if t:
                t['scrape_path'] = scrape_path
                t['scrape_status'] = 'success'
                self._save()

    def get_status(self, title: str, artist: str) -> dict:
        key = self._key(title, artist)
        with self._lock:
            return self._tasks.get(key, {'status': 'idle'})

    def get_all_status(self, songs: List[dict]) -> List[dict]:
        """批量查询状态，songs: [{title, artist}]"""
        result = []
        with self._lock:
            for s in songs:
                key = self._key(s.get('title', ''), s.get('artist', ''))
                t = self._tasks.get(key)
                result.append({'title': s.get('title', ''), 'artist': s.get('artist', ''),
                               'status': t['status'] if t else 'idle'})
        return result

    def list_all(self) -> List[dict]:
        """列出所有下载任务（按更新时间倒序），供下载任务列表展示"""
        with self._lock:
            tasks = [dict(t) for t in self._tasks.values()]
        tasks.sort(key=lambda x: x.get('updated', 0), reverse=True)
        return tasks

    def remove(self, title: str, artist: str, delete_file: bool = False) -> bool:
        """删除一个下载任务记录，可选删除已下载的文件"""
        key = self._key(title, artist)
        with self._lock:
            t = self._tasks.pop(key, None)
            self._save()
        if t and delete_file:
            # 仅删除下载目录的文件，刮削目录的文件不删
            fp = t.get('filepath')
            if fp and os.path.exists(fp):
                try:
                    os.remove(fp)
                except Exception as e:
                    logger.warning(f"删除文件失败: {e}")
        return t is not None



download_manager = DownloadManager()
