"""
音乐刮削器 - 下载文件的元数据刮削、标签写入、按艺术家/专辑整理
流程：解析文件名 → 多源搜元数据 → mutagen写标签 → 移动到 {SCRAPED_DIR}/{artist}/{album}/
"""
import os
import re
import shutil
import logging
import threading
import time
from dataclasses import dataclass, asdict
from typing import List, Optional, Dict

import requests
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2, TPE1, TALB, APIC, TYER, USLT

from app.metadata_sources import METADATA_SOURCES, TrackMeta

logger = logging.getLogger(__name__)
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}


@dataclass
class ScrapeResult:
    title: str
    artist: str
    status: str          # success | failed | scraping
    scraped_path: str = ""
    album: str = ""
    cover_url: str = ""
    source: str = ""
    error: str = ""

    def to_dict(self):
        return asdict(self)


def _safe_dir_name(name: str) -> str:
    """清理目录名非法字符"""
    name = re.sub(r'[\\/:*?"<>|]', '', name).strip()
    return name[:80] if name else 'Unknown'


def parse_filename(filename: str):
    """从 '标题 - 歌手.mp3' 解析出 (title, artist)"""
    base = os.path.splitext(os.path.basename(filename))[0]
    if ' - ' in base:
        parts = base.split(' - ', 1)
        return parts[0].strip(), parts[1].strip()
    return base.strip(), ''


def _match_best(keyword_title: str, keyword_artist: str, candidates: List[TrackMeta]) -> Optional[TrackMeta]:
    """从候选中选最佳匹配（标题+艺术家标准化比对）"""
    def norm(s):
        return re.sub(r'[\s\-\(\)（）【】「」]', '', s.lower())
    kt = norm(keyword_title)
    ka = norm(keyword_artist)
    # 优先：标题完全包含 + 艺术家匹配
    for c in candidates:
        if norm(c.title) == kt and (not ka or ka in norm(c.artist) or norm(c.artist) in ka):
            return c
    # 次选：标题包含
    for c in candidates:
        if kt and (kt in norm(c.title) or norm(c.title) in kt):
            return c
    return candidates[0] if candidates else None


def scrape_meta(title: str, artist: str) -> Optional[TrackMeta]:
    """多源搜元数据，返回最佳匹配的完整元数据（含专辑/封面）"""
    keyword = f"{title} {artist}".strip()
    for src_name, src in METADATA_SOURCES.items():
        try:
            candidates = src.search(keyword, limit=5)
            if not candidates:
                continue
            best = _match_best(title, artist, candidates)
            if not best:
                continue
            # 调详情补全
            detail = src.get_detail(best.source_id)
            if detail and detail.title:
                return detail
            return best
        except NotImplementedError:
            continue
        except Exception as e:
            logger.warning(f"[{src_name}] 刮削搜索失败: {e}")
    return None


def write_tags(filepath: str, meta: TrackMeta) -> bool:
    """用 mutagen 写入 MP3 ID3 标签（标题/艺术家/专辑/封面/年份/歌词）"""
    try:
        audio = MP3(filepath)
        if audio.tags is None:
            audio.add_tags()
        tags = audio.tags
        tags.delall('TIT2'); tags.add(TIT2(encoding=3, text=meta.title))
        tags.delall('TPE1'); tags.add(TPE1(encoding=3, text=meta.artist))
        if meta.album:
            tags.delall('TALB'); tags.add(TALB(encoding=3, text=meta.album))
        # 封面图
        if meta.cover_url:
            try:
                resp = requests.get(meta.cover_url, headers=HEADERS, timeout=15, verify=False)
                if resp.status_code == 200 and resp.content:
                    tags.delall('APIC')
                    tags.add(APIC(encoding=3, mime='image/jpeg', type=3,
                                  desc='Cover', data=resp.content))
            except Exception as e:
                logger.warning(f"封面下载失败: {e}")
        # 歌词（USLT 非同步歌词帧，Navidrome 可读取展示）
        if meta.lyrics:
            tags.delall('USLT')
            tags.add(USLT(encoding=3, lang='chi', desc='', text=meta.lyrics))
        audio.save()
        return True
    except Exception as e:
        logger.warning(f"写标签失败 {filepath}: {e}")
        return False


def organize_file(filepath: str, meta: TrackMeta, dest_dir: str) -> str:
    """按 第一层艺术家/第二层专辑 整理，移动文件。返回新路径"""
    artist_dir = _safe_dir_name(meta.artist or 'Unknown')
    album_dir = _safe_dir_name(meta.album or 'Unknown')
    target_dir = os.path.join(dest_dir, artist_dir, album_dir)
    os.makedirs(target_dir, exist_ok=True)
    filename = os.path.basename(filepath)
    # 用元数据重建文件名：标题 - 歌手.mp3
    ext = os.path.splitext(filename)[1] or '.mp3'
    new_name = f"{_safe_dir_name(meta.title)} - {_safe_dir_name(meta.artist)}{ext}"
    target_path = os.path.join(target_dir, new_name)
    # 重名则加序号
    if os.path.exists(target_path) and os.path.abspath(filepath) != os.path.abspath(target_path):
        base, e = os.path.splitext(target_path)
        i = 1
        while os.path.exists(f"{base}_{i}{e}"):
            i += 1
        target_path = f"{base}_{i}{e}"
    shutil.move(filepath, target_path)
    return target_path


def scrape_and_organize(filepath: str, title: str, artist: str, dest_dir: str) -> ScrapeResult:
    """完整刮削流程：搜元数据 → 写标签 → 整理到 dest_dir"""
    if not os.path.exists(filepath):
        return ScrapeResult(title=title, artist=artist, status='failed', error='文件不存在')
    # 1. 刮元数据
    meta = scrape_meta(title, artist)
    if not meta:
        return ScrapeResult(title=title, artist=artist, status='failed', error='未找到元数据')
    # 2. 写标签
    write_tags(filepath, meta)
    # 3. 整理
    try:
        new_path = organize_file(filepath, meta, dest_dir)
        return ScrapeResult(title=meta.title, artist=meta.artist, status='success',
                            scraped_path=new_path, album=meta.album,
                            cover_url=meta.cover_url, source=meta.source)
    except Exception as e:
        return ScrapeResult(title=meta.title, artist=meta.artist, status='failed',
                            error=f'整理失败: {e}', album=meta.album, source=meta.source)


def scrape_metadata_only(filepath: str, title: str, artist: str):
    """刮削阶段一：搜元数据 + 写标签（不移动文件）。
    返回 (meta, error)；meta 为 None 表示失败。"""
    if not os.path.exists(filepath):
        return None, '文件不存在'
    meta = scrape_meta(title, artist)
    if not meta:
        return None, '未找到元数据'
    write_tags(filepath, meta)
    return meta, ''


# ==================== 刮削任务管理器 ====================
class ScrapeManager:
    """后台执行刮削任务，维护状态供前端轮询"""
    def __init__(self):
        self._tasks: Dict[str, dict] = {}   # key(原title|artist) → task
        self._lock = threading.Lock()
        # 刮削完成回调（由 app.py 注入，用于触发曲库刷新）；为 None 时不触发
        self.on_scrape_complete = None

    def _key(self, title, artist):
        return f"{title}|{artist}"

    def submit(self, title: str, artist: str, filepath: str, dest_dir: str) -> dict:
        key = self._key(title, artist)
        with self._lock:
            existing = self._tasks.get(key)
            # 刮削中或整理中则跳过，避免重复触发
            if existing and (existing.get('scrape_status') == 'scraping'
                             or existing.get('organize_status') == 'organizing'):
                return existing
            self._tasks[key] = {'title': title, 'artist': artist, 'filepath': filepath,
                                'status': 'scraping',
                                'scrape_status': 'scraping', 'organize_status': 'idle',
                                'scraped_path': '', 'album': '', 'source': '',
                                'error': '', 'updated': time.time()}

        def _do():
            # 阶段一：刮削元数据 + 写标签
            meta, err = scrape_metadata_only(filepath, title, artist)
            if not meta:
                with self._lock:
                    t = self._tasks.get(key, {})
                    t.update({'scrape_status': 'failed', 'organize_status': 'idle',
                              'status': 'failed', 'error': err, 'updated': time.time()})
                return
            with self._lock:
                t = self._tasks.get(key, {})
                t.update({'scrape_status': 'scraped', 'organize_status': 'idle',
                          'album': meta.album, 'source': meta.source,
                          'error': '', 'updated': time.time()})
            # 阶段二：整理归档
            with self._lock:
                t = self._tasks.get(key, {})
                t.update({'organize_status': 'organizing', 'updated': time.time()})
            try:
                new_path = organize_file(filepath, meta, dest_dir)
            except Exception as e:
                with self._lock:
                    t = self._tasks.get(key, {})
                    t.update({'organize_status': 'failed', 'status': 'failed',
                              'error': f'整理失败: {e}', 'updated': time.time()})
                return
            with self._lock:
                t = self._tasks.get(key, {})
                t.update({'organize_status': 'success', 'scraped_path': new_path,
                          'status': 'success', 'updated': time.time()})
            # 回写到下载任务记录，试听时用刮削后路径
            try:
                from app.downloader import download_manager
                download_manager.update_scrape_path(title, artist, new_path)
            except Exception:
                pass
            # 触发曲库刷新（让新整理入库的歌曲即时可见）。
            # 回调内部有 loading 守卫：若已有刷新在进行中则直接返回，不重复触发。
            if self.on_scrape_complete:
                try:
                    self.on_scrape_complete()
                except Exception as e:
                    logger.warning(f"刮削完成后触发曲库刷新失败: {e}")
        threading.Thread(target=_do, daemon=True).start()
        return self._tasks[key]

    def get_all_status(self, songs: List[dict]) -> List[dict]:
        result = []
        with self._lock:
            for s in songs:
                key = self._key(s.get('title', ''), s.get('artist', ''))
                t = self._tasks.get(key)
                result.append({'title': s.get('title', ''), 'artist': s.get('artist', ''),
                               'status': t.get('status', 'idle') if t else 'idle',
                               'scrape_status': t.get('scrape_status', 'idle') if t else 'idle',
                               'organize_status': t.get('organize_status', 'idle') if t else 'idle',
                               'scraped_path': t.get('scraped_path', '') if t else '',
                               'album': t.get('album', '') if t else ''})
        return result


scrape_manager = ScrapeManager()
