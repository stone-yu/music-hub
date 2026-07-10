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
from typing import List, Dict

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


# ==================== 注册表 ====================
# 只注册「列表+详情」整条链路验证可用的平台。新增平台：实现 fetch_xxx_hot 并加到这里。
HOT_PLAYLIST_FETCHERS = [
    ("网易云", fetch_netease_hot),
]


def fetch_all_hot(limit_per_source: int = 24) -> Dict[str, List[HotPlaylist]]:
    """获取所有已注册平台的热门歌单，按平台分组返回"""
    results = {}
    for name, fetcher in HOT_PLAYLIST_FETCHERS:
        try:
            results[name] = fetcher(limit_per_source)
        except Exception as e:
            logger.error(f"[{name}] 获取热门歌单失败: {e}")
            results[name] = []
    return results
