"""
热门歌单获取 - 从各平台抓取热门/推荐歌单列表
点击歌单后复用现有的 /api/playlist/from-url 导入流程，故每个歌单都会构造一个
parse_playlist_url 能识别的规范 URL。

注：各平台接口均为非官方逆向接口，随时可能失效。已接入的平台只保留「列表」与
「详情」整条链路均验证可用的；其余平台待接口恢复后在 HOT_PLAYLIST_FETCHERS 注册即可。
"""
import json
import logging
from dataclasses import dataclass, asdict
from typing import List, Dict, Optional

import requests

from searchers import _safe_get, HEADERS

logger = logging.getLogger(__name__)


@dataclass
class HotPlaylist:
    id: str
    name: str
    cover_url: str
    source: str
    url: str           # 规范化的歌单 URL，喂给 /api/playlist/from-url
    play_count: int = 0
    track_count: int = 0

    def to_dict(self):
        return asdict(self)


def _fmt_count(n: int) -> str:
    if not n:
        return ''
    if n >= 100000000:
        return f'{n/100000000:.1f}亿'
    if n >= 10000:
        return f'{n/10000:.1f}万'
    return str(n)


# ==================== 网易云音乐 ====================
def fetch_netease_hot(limit: int = 24) -> List[HotPlaylist]:
    """网易云推荐歌单（/api/personalized/playlist，列表+详情链路均已验证可用）"""
    playlists = []
    resp = _safe_get(
        'https://music.163.com/api/personalized/playlist',
        headers={**HEADERS, 'Referer': 'https://music.163.com/'},
        params={'limit': limit},
        timeout=15,
    )
    if not resp:
        return playlists
    try:
        for item in resp.json().get('result', []):
            pid = str(item.get('id', ''))
            if not pid:
                continue
            playlists.append(HotPlaylist(
                id=pid,
                name=item.get('name', '').strip(),
                cover_url=item.get('picUrl', ''),
                source='网易云',
                url=f'https://music.163.com/#/playlist?id={pid}',
                play_count=item.get('playCount', 0) or 0,
                track_count=item.get('trackCount', 0) or 0,
            ))
    except Exception as e:
        logger.warning(f"网易云热门歌单解析失败: {e}")
    logger.info(f"网易云热门歌单: {len(playlists)} 个")
    return playlists


# 网易云歌单分类：精简后的常用分类（从 catalogue 接口的 70 个里挑高频的，
# 避免标签条过长。"热门"作为首项，走 personalized 推荐接口）。
NETEASE_CATEGORIES = [
    ("热门", "热门"), ("华语", "华语"), ("流行", "流行"), ("摇滚", "摇滚"),
    ("民谣", "民谣"), ("电子", "电子"), ("说唱", "说唱"), ("轻音乐", "轻音乐"),
    ("怀旧", "怀旧"), ("影视原声", "影视原声"), ("ACG", "ACG"), ("经典", "经典"),
]


def fetch_netease_by_category(cat: str, limit: int = 24) -> List[HotPlaylist]:
    """网易云按分类拉歌单。cat="热门" 走推荐接口，其余走 /api/playlist/list?cat=xxx。
    已验证：华语/流行/摇滚/民谣 等分类均返回完整歌单(含播放数/歌曲数)。"""
    if cat == '热门' or not cat:
        return fetch_netease_hot(limit)
    playlists = []
    resp = _safe_get(
        'https://music.163.com/api/playlist/list',
        headers={**HEADERS, 'Referer': 'https://music.163.com/'},
        params={'cat': cat, 'order': 'hot', 'limit': limit, 'offset': 0},
        timeout=15,
    )
    if not resp:
        return playlists
    try:
        for item in resp.json().get('playlists', []):
            pid = str(item.get('id', ''))
            if not pid:
                continue
            playlists.append(HotPlaylist(
                id=pid,
                name=item.get('name', '').strip(),
                cover_url=item.get('coverImgUrl', ''),
                source='网易云',
                url=f'https://music.163.com/#/playlist?id={pid}',
                play_count=item.get('playCount', 0) or 0,
                track_count=item.get('trackCount', 0) or 0,
            ))
    except Exception as e:
        logger.warning(f"网易云分类歌单解析失败 cat={cat}: {e}")
    logger.info(f"网易云[{cat}]歌单: {len(playlists)} 个")
    return playlists


# ==================== QQ音乐（列表可用，详情需签名，暂未启用）====================
def fetch_qq_hot(limit: int = 24) -> List[HotPlaylist]:
    """QQ音乐热门歌单广场。列表可获取，但歌单详情接口需签名/登录，点击导入会失败，
    因此暂不注册进 HOT_PLAYLIST_FETCHERS。保留实现待详情接口恢复后启用。"""
    playlists = []
    resp = _safe_get(
        'https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg',
        headers={**HEADERS, 'Referer': 'https://y.qq.com/'},
        params={'categoryId': 10000000, 'sortId': 5, 'format': 'json', 'sin': 0, 'ein': limit},
        timeout=15,
    )
    if not resp:
        return playlists
    try:
        # QQ 该接口返回 GBK 编码
        data = json.loads(resp.content.decode('gb18030'))
        for item in data.get('data', {}).get('list', []):
            did = str(item.get('dissid', ''))
            if not did:
                continue
            playlists.append(HotPlaylist(
                id=did,
                name=item.get('dissname', '').strip(),
                cover_url=item.get('imgurl', '').replace('http://', 'https://'),
                source='QQ音乐',
                url=f'https://y.qq.com/n/ryqq/playlist/{did}.html',
                play_count=item.get('listennum', 0) or 0,
            ))
    except Exception as e:
        logger.warning(f"QQ热门歌单解析失败: {e}")
    logger.info(f"QQ热门歌单: {len(playlists)} 个")
    return playlists


# ==================== 酷狗音乐 ====================
def fetch_kugou_hot(limit: int = 24) -> List[HotPlaylist]:
    """酷狗热门歌单广场（m.kugou.com/plist/index，列表+详情链路均已验证可用）"""
    playlists = []
    pagesize = min(limit, 30)
    resp = _safe_get(
        'http://m.kugou.com/plist/index',
        headers={**HEADERS, 'Referer': 'http://www.kugou.com/'},
        params={'json': True, 'page': 1, 'pagesize': pagesize},
        timeout=15,
    )
    if not resp:
        return playlists
    try:
        info = resp.json().get('plist', {}).get('list', {}).get('info', [])
        for item in info:
            pid = str(item.get('specialid', ''))
            if not pid:
                continue
            # 酷狗封面 URL 含 {size} 占位符，替换为实际尺寸
            cover = item.get('imgurl', '').replace('http://', 'https://')
            cover = cover.replace('{size}', '480')
            playlists.append(HotPlaylist(
                id=pid,
                name=item.get('specialname', '').strip(),
                cover_url=cover,
                source='酷狗',
                url=f'https://www.kugou.com/yy/html/special/{pid}.html',
                play_count=item.get('playcount', 0) or 0,
                track_count=item.get('songcount', 0) or 0,
            ))
    except Exception as e:
        logger.warning(f"酷狗热门歌单解析失败: {e}")
    logger.info(f"酷狗热门歌单: {len(playlists)} 个")
    return playlists[:limit]


# ==================== 注册表 ====================
# 只注册「列表+详情」整条链路验证可用的平台。新增平台：实现 fetch_xxx_hot 并加到这里。
HOT_PLAYLIST_FETCHERS = [
    ("网易云", fetch_netease_hot),
    ("酷狗", fetch_kugou_hot),
]


def fetch_all_hot(limit_per_source: int = 24, sources: Optional[List[str]] = None) -> Dict[str, List[HotPlaylist]]:
    """获取所有(或指定)平台的热门歌单，按平台分组返回"""
    results = {}
    for name, fetcher in HOT_PLAYLIST_FETCHERS:
        if sources and name not in sources:
            continue
        try:
            results[name] = fetcher(limit_per_source)
        except Exception as e:
            logger.error(f"[{name}] 获取热门歌单失败: {e}")
            results[name] = []
    return results
