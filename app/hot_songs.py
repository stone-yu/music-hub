"""
各平台歌曲排行榜 - 网易云/QQ音乐/酷狗
排行榜本质是一个固定歌单，复用 searchers.Song 数据类与 match_key 匹配逻辑。
点击某榜单后取其歌曲，与本地曲库匹配（在 app.py 层完成）。
"""
import json
import logging
import time
from dataclasses import dataclass, asdict
from typing import List

from searchers import _safe_get, _safe_post, HEADERS, Song

logger = logging.getLogger(__name__)


@dataclass
class Rank:
    """一个排行榜"""
    id: str          # 平台内榜单ID
    name: str        # 榜单名
    source: str      # 平台名
    cover_url: str = ""

    def to_dict(self):
        return asdict(self)


# ==================== 网易云音乐（固定榜单ID）====================
# 网易云官方榜的 playlist id 是固定的，直接枚举
NETEASE_RANKS = [
    Rank(id="3778678", name="热歌榜", source="网易云"),
    Rank(id="3779629", name="新歌榜", source="网易云"),
    Rank(id="19723756", name="飙升榜", source="网易云"),
    Rank(id="2884035", name="原创榜", source="网易云"),
    Rank(id="991319590", name="中文说唱榜", source="网易云"),
]

def netease_ranks() -> List[Rank]:
    return list(NETEASE_RANKS)

def fetch_netease_rank_songs(rank_id: str, limit: int = 100) -> List[Song]:
    # 网易云 playlist/detail 首次请求偶发返回空 tracks，重试一次
    for attempt in range(2):
        resp = _safe_get(
            f'http://music.163.com/api/playlist/detail?id={rank_id}',
            headers={**HEADERS, 'Referer': 'https://music.163.com/'},
            timeout=15,
        )
        if not resp:
            return []
        songs = []
        try:
            data = resp.json()
            result = data.get('result', data.get('playlist', {}))
            tracks = result.get('tracks', [])
            for track in tracks[:limit]:
                title = track.get('name', '')
                artists = '/'.join([a.get('name', '') for a in track.get('artists', track.get('ar', []))])
                album = track.get('album', track.get('al', {})).get('name', '')
                if title and artists:
                    songs.append(Song(title=title, artist=artists, album=album, source='网易'))
            if songs:
                return songs
        except Exception as e:
            logger.warning(f"网易云榜单歌曲解析失败: {e}")
            return []
        # 空结果重试一次（网易云偶发空响应）
        if attempt == 0:
            logger.info(f"网易云榜单 {rank_id} 首次返回空，重试")
            time.sleep(0.5)
    return []


# ==================== QQ音乐 ====================
def fetch_qq_ranks() -> List[Rank]:
    """QQ音乐排行榜列表（ToplistInfoServer.GetAll）"""
    data_str = ('{"comm":{"ct":24,"cv":4747474},'
                '"toplist":{"module":"musicToplist.ToplistInfoServer","method":"GetAll","param":{}}}')
    resp = _safe_get(
        'https://u.y.qq.com/cgi-bin/musicu.fcg',
        headers={**HEADERS, 'Referer': 'https://y.qq.com/'},
        params={'data': data_str},
        timeout=15,
    )
    if not resp:
        return []
    ranks = []
    try:
        data = resp.json().get('toplist', {}).get('data', {})
        for group in data.get('group', []):
            for t in group.get('toplist', []):
                tid = str(t.get('topId', ''))
                if tid:
                    ranks.append(Rank(id=tid, name=t.get('title', '').strip(), source='QQ音乐',
                                      cover_url=t.get('picUrl', '')))
    except Exception as e:
        logger.warning(f"QQ榜单列表解析失败: {e}")
    return ranks

def fetch_qq_rank_songs(rank_id: str, limit: int = 100) -> List[Song]:
    data_str = ('{"comm":{"ct":24,"cv":4747474},'
                '"toplist":{"module":"musicToplist.ToplistInfoServer","method":"GetDetail",'
                '"param":{"topId":' + str(rank_id) + ',"offset":0,"num":' + str(limit) + '}}}')
    resp = _safe_get(
        'https://u.y.qq.com/cgi-bin/musicu.fcg',
        headers={**HEADERS, 'Referer': 'https://y.qq.com/'},
        params={'data': data_str},
        timeout=15,
    )
    if not resp:
        return []
    songs = []
    try:
        data = resp.json().get('toplist', {}).get('data', {})
        for s in data.get('songInfoList', []):
            title = s.get('title', '')
            artists = '/'.join([si.get('name', '') for si in s.get('singer', [])])
            album = s.get('album', {}).get('name', '')
            if title and artists:
                songs.append(Song(title=title, artist=artists, album=album, source='QQ'))
    except Exception as e:
        logger.warning(f"QQ榜单歌曲解析失败: {e}")
    return songs


# ==================== 酷狗 ====================
def fetch_kugou_ranks() -> List[Rank]:
    """酷狗排行榜列表"""
    resp = _safe_get(
        'http://mobilecdn.kugou.com/api/v3/rank/list',
        params={'version': 9108, 'page': 1, 'pagesize': 30},
        timeout=15,
    )
    if not resp:
        return []
    ranks = []
    try:
        for item in resp.json().get('data', {}).get('info', []):
            rid = str(item.get('rankid', ''))
            if rid:
                ranks.append(Rank(id=rid, name=item.get('rankname', '').strip(), source='酷狗',
                                  cover_url=item.get('banner_9') or item.get('base_img') or ''))
    except Exception as e:
        logger.warning(f"酷狗榜单列表解析失败: {e}")
    return ranks

def fetch_kugou_rank_songs(rank_id: str, limit: int = 100) -> List[Song]:
    resp = _safe_get(
        'http://mobilecdn.kugou.com/api/v3/rank/song',
        params={'rankid': rank_id, 'page': 1, 'pagesize': limit, 'version': 9108},
        timeout=15,
    )
    if not resp:
        return []
    songs = []
    try:
        for item in resp.json().get('data', {}).get('info', []):
            title = item.get('songname', '')
            artist = item.get('singername') or ''
            # singername 为空时，从 filename "歌手 - 歌名" 提取
            if not artist and item.get('filename') and ' - ' in item['filename']:
                parts = item['filename'].split(' - ', 1)
                artist = parts[0].strip()
                if not title:
                    title = parts[1].strip()
            if title and artist:
                songs.append(Song(title=title, artist=artist, source='酷狗'))
    except Exception as e:
        logger.warning(f"酷狗榜单歌曲解析失败: {e}")
    return songs


# ==================== 注册表 ====================
# 每个平台：榜单列表函数 + 榜单歌曲函数
RANK_PROVIDERS = {
    "网易云": {"ranks": netease_ranks, "songs": fetch_netease_rank_songs},
    "QQ音乐": {"ranks": fetch_qq_ranks, "songs": fetch_qq_rank_songs},
    "酷狗":   {"ranks": fetch_kugou_ranks, "songs": fetch_kugou_rank_songs},
}

# 平台 -> source 字段（用于匹配时区分来源，与 searchers 一致）
SOURCE_BY_PLATFORM = {"网易云": "网易", "QQ音乐": "QQ", "酷狗": "酷狗"}


def get_all_ranks() -> dict:
    """获取所有平台的榜单列表，按平台分组"""
    grouped = {}
    for name, prov in RANK_PROVIDERS.items():
        try:
            grouped[name] = [r.to_dict() for r in prov["ranks"]()]
        except Exception as e:
            logger.error(f"[{name}] 获取榜单失败: {e}")
            grouped[name] = []
    return grouped


def fetch_rank_songs(source: str, rank_id: str, limit: int = 100) -> List[Song]:
    """取某平台某榜单的歌曲"""
    prov = RANK_PROVIDERS.get(source)
    if not prov:
        return []
    return prov["songs"](rank_id, limit)
