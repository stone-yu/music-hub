"""
多平台音乐搜索引擎 - 酷我、网易、QQ音乐、酷狗、咪咕
"""
import re
import json
import logging
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict
import requests

logger = logging.getLogger(__name__)

@dataclass
class Song:
    title: str
    artist: str
    album: str = ""
    source: str = ""

    def to_dict(self):
        return asdict(self)

    @property
    def match_key(self) -> str:
        """用于匹配的标准化 key"""
        t = re.sub(r'[\s\-\(\)（）\[\]【】「」《》]', '', self.title.lower())
        a = re.sub(r'[\s\-\(\)（）\[\]【】「」《》]', '', self.artist.lower())
        t = re.sub(r'feat\.?|ft\.?|合唱|对唱|live|remix|cover|翻唱|伴奏|dj.*版|完整版', '', t)
        a = re.sub(r'feat\.?|ft\.?|&|、|，', '', a)
        return f"{t}|{a}"


HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}


def _safe_get(url, headers=None, params=None, timeout=10):
    try:
        resp = requests.get(url, headers=headers or HEADERS, params=params,
                          timeout=timeout, allow_redirects=True, verify=False)
        resp.raise_for_status()
        return resp
    except Exception as e:
        logger.warning(f"Request failed for {url}: {e}")
        return None

def _safe_post(url, headers=None, data=None, timeout=10):
    try:
        resp = requests.post(url, headers=headers or HEADERS, data=data,
                           timeout=timeout, allow_redirects=True, verify=False)
        resp.raise_for_status()
        return resp
    except Exception as e:
        logger.warning(f"POST failed for {url}: {e}")
        return None


# ==================== 酷我音乐 ====================
def search_kuwo(keyword: str, limit: int = 30) -> List[Song]:
    """酷我音乐搜索（使用旧版 API）"""
    songs = []
    try:
        resp = _safe_get(
            'http://search.kuwo.cn/r.s',
            params={'all': keyword, 'ft': 'music', 'rformat': 'json',
                    'encoding': 'utf8', 'pn': 0, 'rn': limit}
        )
        if resp:
            # 酷我返回的是 Python dict 格式（单引号），需要修复
            text = resp.text.replace("'", '"')
            # 清理 &nbsp;
            text = text.replace('&nbsp;', ' ')
            data = json.loads(text)
            for item in data.get('abslist', []):
                title = item.get('SONGNAME', '').strip()
                artist = item.get('ARTIST', '').strip()
                album = item.get('ALBUM', '').strip()
                if title and artist:
                    songs.append(Song(title=title, artist=artist, album=album, source='酷我'))
    except Exception as e:
        logger.warning(f"Kuwo search error: {e}")
    return songs


# ==================== 网易云音乐 ====================
def search_netease(keyword: str, limit: int = 30) -> List[Song]:
    """网易云音乐搜索"""
    songs = []
    try:
        resp = _safe_post(
            'http://music.163.com/api/search/get/web',
            headers={**HEADERS, 'Referer': 'https://music.163.com/'},
            data={'s': keyword, 'type': 1, 'limit': limit, 'offset': 0}
        )
        if resp:
            result = resp.json()
            for item in result.get('result', {}).get('songs', []):
                title = item.get('name', '')
                artists = '/'.join([a.get('name', '') for a in item.get('artists', [])])
                album = item.get('album', {}).get('name', '')
                if title and artists:
                    songs.append(Song(title=title, artist=artists, album=album, source='网易'))
    except Exception as e:
        logger.warning(f"Netease search error: {e}")
    return songs


# ==================== QQ音乐 ====================
def search_qq(keyword: str, limit: int = 30) -> List[Song]:
    """QQ音乐搜索"""
    songs = []
    try:
        resp = _safe_get(
            'https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp',
            headers={**HEADERS, 'Referer': 'https://y.qq.com/'},
            params={'w': keyword, 'format': 'json', 'p': 1, 'n': limit, 'cr': 1}
        )
        if resp:
            data = resp.json()
            for item in data.get('data', {}).get('song', {}).get('list', []):
                title = item.get('songname', '')
                artists = '/'.join([a.get('name', '') for a in item.get('singer', [])])
                album = item.get('albumname', '')
                if title and artists:
                    songs.append(Song(title=title, artist=artists, album=album, source='QQ'))
    except Exception as e:
        logger.warning(f"QQ Music search error: {e}")
    return songs


# ==================== 酷狗音乐 ====================
def search_kugou(keyword: str, limit: int = 30) -> List[Song]:
    """酷狗音乐搜索"""
    songs = []
    try:
        resp = _safe_get(
            'http://mobilecdn.kugou.com/api/v3/search/song',
            params={'keyword': keyword, 'format': 'json', 'page': 1, 'pagesize': limit}
        )
        if resp:
            data = resp.json()
            for item in data.get('data', {}).get('info', []):
                title = item.get('songname', '')
                artist = item.get('singername', '')
                if ' - ' in title:
                    title = title.split(' - ')[0]
                if title and artist:
                    songs.append(Song(title=title, artist=artist, source='酷狗'))
    except Exception as e:
        logger.warning(f"Kugou search error: {e}")
    return songs


# ==================== 咪咕音乐 ====================
def search_migu(keyword: str, limit: int = 30) -> List[Song]:
    """咪咕音乐搜索"""
    songs = []
    try:
        resp = _safe_get(
            'https://app.c.nf.migu.cn/MIGUM3.0/v1.0/content/search_all.do',
            params={'ua': 'Android_migu', 'version': '5.0.1', 'text': keyword,
                    'pageNo': 1, 'pageSize': limit, 'resourceType': 'song'}
        )
        if resp:
            data = resp.json()
            for item in data.get('songResultData', {}).get('result', []):
                title = item.get('name', '')
                singers = item.get('singers', [])
                artist = singers[0].get('name', '') if singers else ''
                album = item.get('albums', [{}])[0].get('name', '') if item.get('albums') else ''
                if title and artist:
                    songs.append(Song(title=title, artist=artist, album=album, source='咪咕'))
    except Exception as e:
        logger.warning(f"Migu search error: {e}")
    return songs


# ==================== 聚合搜索 ====================
ALL_SEARCHERS = [
    ("酷我", search_kuwo),
    ("网易云", search_netease),
    ("QQ音乐", search_qq),
    ("酷狗", search_kugou),
]


def search_all(keyword: str, limit_per_source: int = 30) -> Dict[str, List[Song]]:
    """从所有平台搜索，返回按平台分组的结果"""
    results = {}
    for name, searcher in ALL_SEARCHERS:
        try:
            songs = searcher(keyword, limit_per_source)
            results[name] = songs
            logger.info(f"[{name}] 搜索 '{keyword}' 找到 {len(songs)} 首")
        except Exception as e:
            logger.error(f"[{name}] 搜索失败: {e}")
            results[name] = []
    return results


def search_all_merged(keyword: str, limit_per_source: int = 30) -> List[Song]:
    """从所有平台搜索，合并去重"""
    all_songs = []
    seen = set()
    results = search_all(keyword, limit_per_source)
    for source_name, songs in results.items():
        for song in songs:
            key = song.match_key
            if key not in seen:
                seen.add(key)
                all_songs.append(song)
    return all_songs
