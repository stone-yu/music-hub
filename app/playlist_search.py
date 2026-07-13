"""
各平台歌单搜索 - 按关键词搜网易云/QQ/酷狗/酷我的歌单列表。
结果复用 HotPlaylist dataclass，点击后用其中的 url 走 /api/playlist/from-url 导入。

接口参考 github.com/guohuiyuan/music-lib，但选用更简单的非加密实现(已验证)。
"""
import ast
import logging
from typing import List, Dict, Optional

from searchers import _safe_get, _safe_post, HEADERS
from app.hot_playlists import HotPlaylist

logger = logging.getLogger(__name__)


def search_netease_playlists(keyword: str, limit: int = 10) -> List[HotPlaylist]:
    """网易云歌单搜索(api/search/get/web, type=1000)"""
    playlists = []
    resp = _safe_post(
        'http://music.163.com/api/search/get/web',
        headers={**HEADERS, 'Referer': 'https://music.163.com/'},
        data={'s': keyword, 'type': 1000, 'limit': limit, 'offset': 0},
    )
    if not resp:
        return playlists
    try:
        for item in resp.json().get('result', {}).get('playlists', []):
            pid = str(item.get('id', ''))
            if not pid:
                continue
            creator = item.get('creator', {})
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
        logger.warning(f"网易云歌单搜索解析失败: {e}")
    logger.info(f"网易云歌单搜索 '{keyword}': {len(playlists)} 个")
    return playlists


def search_qq_playlists(keyword: str, limit: int = 10) -> List[HotPlaylist]:
    """QQ歌单搜索(client_music_search_songlist)。响应是纯 JSON。"""
    playlists = []
    resp = _safe_get(
        'http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist',
        headers={**HEADERS, 'Referer': 'https://y.qq.com/portal/search.html'},
        params={'query': keyword, 'page_no': 0, 'num_per_page': limit,
                'format': 'json', 'remoteplace': 'txt.yqq.playlist', 'flag_qc': 0},
    )
    if not resp:
        return playlists
    try:
        # 偶尔返回 JSONP 外壳 (...)，剥掉再解析
        text = resp.text.strip()
        if text.startswith('(') and text.endswith(')'):
            text = text[1:-1]
        import json
        data = json.loads(text)
        for item in data.get('data', {}).get('list', []):
            did = str(item.get('dissid', ''))
            if not did:
                continue
            cover = item.get('imgurl', '')
            if cover.startswith('http://'):
                cover = 'https://' + cover[len('http://'):]
            creator = item.get('creator', {})
            playlists.append(HotPlaylist(
                id=did,
                name=item.get('dissname', '').strip(),
                cover_url=cover,
                source='QQ音乐',
                url=f'https://y.qq.com/n/ryqq/playlist/{did}',
                play_count=item.get('listennum', 0) or 0,
                track_count=item.get('song_count', 0) or 0,
            ))
    except Exception as e:
        logger.warning(f"QQ歌单搜索解析失败: {e}")
    logger.info(f"QQ歌单搜索 '{keyword}': {len(playlists)} 个")
    return playlists


def search_kugou_playlists(keyword: str, limit: int = 10) -> List[HotPlaylist]:
    """酷狗歌单搜索(api/v3/search/special)。封面 url 含 {size} 占位符。"""
    playlists = []
    resp = _safe_get(
        'http://mobilecdn.kugou.com/api/v3/search/special',
        params={'keyword': keyword, 'platform': 'WebFilter', 'format': 'json',
                'page': 1, 'pagesize': limit, 'filter': 0},
    )
    if not resp:
        return playlists
    try:
        for item in resp.json().get('data', {}).get('info', []):
            pid = str(item.get('specialid', ''))
            if not pid:
                continue
            cover = item.get('imgurl', '').replace('{size}', '480')
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
        logger.warning(f"酷狗歌单搜索解析失败: {e}")
    logger.info(f"酷狗歌单搜索 '{keyword}': {len(playlists)} 个")
    return playlists


def search_kuwo_playlists(keyword: str, limit: int = 10) -> List[HotPlaylist]:
    """酷我歌单搜索(search.kuwo.cn/r.s, ft=playlist)。
    响应是 Python 风格单引号 dict(非标准 JSON)，用 ast.literal_eval 解析。"""
    playlists = []
    resp = _safe_get(
        'http://search.kuwo.cn/r.s',
        params={'all': keyword, 'ft': 'playlist', 'itemset': 'web_2013', 'client': 'kt',
                'pn': 0, 'rn': limit, 'rformat': 'json', 'encoding': 'utf8'},
    )
    if not resp:
        return playlists
    try:
        data = ast.literal_eval(resp.text)
        for item in data.get('abslist', []):
            pid = str(item.get('DC_TARGETID') or item.get('playlistid') or '')
            if not pid:
                continue
            cover = item.get('pic') or item.get('hts_pic') or ''
            if cover and not cover.startswith('http'):
                cover = 'http://' + cover
            try:
                track_count = int(item.get('songnum', 0) or 0)
            except (ValueError, TypeError):
                track_count = 0
            playlists.append(HotPlaylist(
                id=pid,
                name=item.get('name', '').strip(),
                cover_url=cover,
                source='酷我',
                url=f'http://www.kuwo.cn/playlist_detail/{pid}',
                track_count=track_count,
            ))
    except Exception as e:
        logger.warning(f"酷我歌单搜索解析失败: {e}")
    logger.info(f"酷我歌单搜索 '{keyword}': {len(playlists)} 个")
    return playlists


# ==================== 注册表 ====================
PLAYLIST_SEARCHERS = [
    ("网易云", search_netease_playlists),
    ("QQ音乐", search_qq_playlists),
    ("酷狗", search_kugou_playlists),
    ("酷我", search_kuwo_playlists),
]


def search_all_playlists(keyword: str, sources: Optional[List[str]] = None) -> Dict[str, List[HotPlaylist]]:
    """搜索所有(或指定)平台的歌单，按平台分组返回"""
    results = {}
    for name, fetcher in PLAYLIST_SEARCHERS:
        if sources and name not in sources:
            continue
        try:
            results[name] = fetcher(keyword)
        except Exception as e:
            logger.error(f"[{name}] 歌单搜索失败: {e}")
            results[name] = []
    return results
