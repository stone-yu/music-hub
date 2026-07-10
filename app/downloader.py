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


def kuwo_download(title: str, artist: str, save_dir: str) -> DownloadResult:
    """搜索并下载一首歌（酷我源）。取搜索结果第一首下载。"""
    keyword = f"{title} {artist}"
    results = kuwo_search(keyword, limit=5)
    if not results:
        return DownloadResult(title=title, artist=artist, source='酷我',
                              status='notfound', error='搜索无结果')
    # 取第一首（最相关）
    target = results[0]
    url = kuwo_get_url(target['rid'])
    if not url:
        return DownloadResult(title=title, artist=artist, source='酷我',
                              status='failed', error='获取下载URL失败')
    os.makedirs(save_dir, exist_ok=True)
    filename = f"{_safe_filename(target['title'])} - {_safe_filename(target['artist'])}.mp3"
    filepath = os.path.join(save_dir, filename)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=60, stream=True)
        resp.raise_for_status()
        with open(filepath, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        logger.info(f"下载成功: {filename} ({os.path.getsize(filepath)} bytes)")
        return DownloadResult(title=target['title'], artist=target['artist'],
                              source='酷我', status='success', filepath=filepath)
    except Exception as e:
        logger.warning(f"下载失败 {filename}: {e}")
        return DownloadResult(title=title, artist=artist, source='酷我',
                              status='failed', error=str(e))


# ==================== 下载源注册表 ====================
# 后续新增平台：实现 download(title, artist, save_dir) -> DownloadResult 并注册
DOWNLOAD_SOURCES = {
    "酷我": kuwo_download,
}


# ==================== 下载管理器（状态缓存） ====================
class DownloadManager:
    """管理后台下载任务，维护下载状态供前端轮询"""
    def __init__(self):
        self._tasks: Dict[str, dict] = {}   # key → task信息
        self._lock = threading.Lock()

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
        def _do():
            fn = DOWNLOAD_SOURCES.get(source)
            if not fn:
                res = DownloadResult(title, artist, source, 'failed', error='不支持的平台')
            else:
                res = fn(title, artist, save_dir)
            with self._lock:
                t = self._tasks.get(key, {})
                t.update({'status': res.status, 'filepath': res.filepath,
                          'error': res.error, 'updated': time.time()})
        threading.Thread(target=_do, daemon=True).start()
        return self._tasks[key]

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


download_manager = DownloadManager()
