"""
歌单链接解析器 - 从各大音乐平台歌单URL中提取歌曲列表
支持：网易云音乐、QQ音乐、酷我音乐、酷狗音乐
"""
import re
import json
import logging
from typing import List, Optional, Tuple
import requests

from searchers import Song

logger = logging.getLogger(__name__)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}


def parse_playlist_url(url: str) -> Tuple[Optional[str], Optional[str]]:
    """
    解析歌单URL，返回 (平台名, 歌单ID)
    支持的格式：
    - 网易云: https://music.163.com/#/playlist?id=123456
    - 网易云: https://music.163.com/playlist/123456
    - QQ音乐: https://y.qq.com/n/yqq/playlist/123456.html
    - 酷我:   http://www.kuwo.cn/playlist/123456
    - 酷狗:   https://www.kugou.com/yy/html/special/123456.html
    """
    url = url.strip()

    # 网易云音乐
    m = re.search(r'music\.163\.com.*?playlist[/\?].*?id=(\d+)', url)
    if m:
        return ('netease', m.group(1))
    m = re.search(r'music\.163\.com/playlist/(\d+)', url)
    if m:
        return ('netease', m.group(1))

    # QQ音乐
    m = re.search(r'y\.qq\.com.*?playlist/(\d+)', url)
    if m:
        return ('qq', m.group(1))
    m = re.search(r'y\.qq\.com.*?id=(\d+)', url)
    if m:
        return ('qq', m.group(1))

    # 酷我音乐
    m = re.search(r'kuwo\.cn/playlist(?:_detail)?/(\d+)', url)
    if m:
        return ('kuwo', m.group(1))
    m = re.search(r'kuwo\.cn.*?pid=(\d+)', url)
    if m:
        return ('kuwo', m.group(1))

    # 酷狗音乐
    m = re.search(r'kugou\.com.*?special/(\d+)', url)
    if m:
        return ('kugou', m.group(1))
    m = re.search(r'kugou\.com.*?code=(\w+)', url)
    if m:
        return ('kugou', m.group(1))

    return (None, None)


def fetch_netease_playlist(playlist_id: str) -> Tuple[str, List[Song]]:
    """获取网易云音乐歌单"""
    try:
        # 使用 Web API 获取歌单详情
        url = f"http://music.163.com/api/playlist/detail?id={playlist_id}"
        resp = requests.get(url, headers={**HEADERS, 'Referer': 'https://music.163.com/'}, timeout=15)
        data = resp.json()
        result = data.get('result', data.get('playlist', {}))
        playlist_name = result.get('name', '网易云歌单')
        tracks = result.get('tracks', [])

        songs = []
        for track in tracks:
            title = track.get('name', '')
            artists = '/'.join([a.get('name', '') for a in track.get('artists', track.get('ar', []))])
            album = track.get('album', track.get('al', {})).get('name', '')
            if title and artists:
                songs.append(Song(title=title, artist=artists, album=album, source='网易'))

        logger.info(f"网易云歌单 '{playlist_name}': {len(songs)} 首歌曲")
        return (playlist_name, songs)

    except Exception as e:
        logger.error(f"获取网易云歌单失败: {e}")
        return ('网易云歌单', [])


def fetch_qq_playlist(playlist_id: str) -> Tuple[str, List[Song]]:
    """获取QQ音乐歌单"""
    try:
        url = "https://c.y.qq.com/v8/fcg-bin/fcg_v8_playlist_cp.fcg"
        params = {
            'disstid': playlist_id,
            'type': 1,
            'json': 1,
            'utf8': 1,
            'onlysong': 0,
            'new_format': 1,
            'loginUin': 0,
            'hostUin': 0,
            'format': 'json',
            'inCharset': 'utf8',
            'outCharset': 'utf-8',
            'notice': 0,
            'platform': 'yqq.json',
            'needNewCode': 0,
        }
        resp = requests.get(url, params=params, headers={**HEADERS, 'Referer': 'https://y.qq.com/'}, timeout=15)
        data = resp.json()
        cdlist = data.get('data', {}).get('cdlist', [])
        if not cdlist:
            return ('QQ音乐歌单', [])

        playlist_data = cdlist[0]
        playlist_name = playlist_data.get('dissname', 'QQ音乐歌单')
        songs_data = playlist_data.get('songlist', [])

        songs = []
        for item in songs_data:
            title = item.get('name', item.get('songname', ''))
            singers = item.get('singer', [])
            artist = '/'.join([s.get('name', '') for s in singers]) if singers else item.get('singername', '')
            album = item.get('album', {}).get('name', item.get('albumname', ''))
            if title and artist:
                songs.append(Song(title=title, artist=artist, album=album, source='QQ'))

        logger.info(f"QQ音乐歌单 '{playlist_name}': {len(songs)} 首歌曲")
        return (playlist_name, songs)

    except Exception as e:
        logger.error(f"获取QQ音乐歌单失败: {e}")
        return ('QQ音乐歌单', [])


def fetch_kuwo_playlist(playlist_id: str) -> Tuple[str, List[Song]]:
    """获取酷我音乐歌单（从页面HTML解析）"""
    try:
        url = f'http://www.kuwo.cn/playlist_detail/{playlist_id}'
        resp = requests.get(url, headers=HEADERS, timeout=15)
        text = resp.text

        # 从页面标题获取歌单名
        title_match = re.search(r'<title>(.*?)</title>', text)
        playlist_name = '酷我歌单'
        if title_match:
            raw_title = title_match.group(1)
            name_parts = raw_title.split('_')
            if name_parts:
                playlist_name = name_parts[0].strip()

        # 从HTML解析歌曲：每个歌曲项在 <li class="song_item"> 中
        # 结构：<a title="歌名" href="/play_detail/ID">歌名</a>
        #        <div class="song_artist"><span title="歌手">歌手</span></div>
        songs = []
        for match in re.finditer(r'<a[^>]*title="([^"]+)"[^>]*href="/play_detail/(\d+)"[^>]*>', text):
            song_name = match.group(1).strip()
            # 获取链接后面的文本，查找 song_artist
            after = text[match.end():match.end()+800]
            artist_match = re.search(r'class="song_artist"[^>]*>.*?<span[^>]*title="([^"]+)"', after, re.DOTALL)
            artist = artist_match.group(1).strip() if artist_match else ''
            # 清理 HTML 实体
            artist = artist.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
            if song_name and artist:
                songs.append(Song(title=song_name, artist=artist, source='酷我'))

        logger.info(f"酷我歌单 '{playlist_name}': {len(songs)} 首歌曲")
        return (playlist_name, songs)

    except Exception as e:
        logger.error(f"获取酷我歌单失败: {e}")
        return ('酷我歌单', [])


def fetch_kugou_playlist(playlist_id: str) -> Tuple[str, List[Song]]:
    """获取酷狗音乐歌单"""
    try:
        url = "http://mobilecdn.kugou.com/api/v3/special/song"
        params = {'specialid': playlist_id, 'page': 1, 'pagesize': 100, 'plat': 2, 'version': 8970}
        resp = requests.get(url, headers=HEADERS, timeout=15)
        data = resp.json()
        info = data.get('data', {}).get('info', [])

        songs = []
        for item in info:
            title = item.get('songname', '')
            artist = item.get('singername', '')
            if ' - ' in title:
                title = title.split(' - ')[0]
            if title and artist:
                songs.append(Song(title=title, artist=artist, source='酷狗'))

        logger.info(f"酷狗歌单: {len(songs)} 首歌曲")
        return ('酷狗歌单', songs)

    except Exception as e:
        logger.error(f"获取酷狗歌单失败: {e}")
        return ('酷狗歌单', [])


# 平台抓取器映射
FETCHERS = {
    'netease': fetch_netease_playlist,
    'qq': fetch_qq_playlist,
    'kuwo': fetch_kuwo_playlist,
    'kugou': fetch_kugou_playlist,
}


def fetch_playlist_from_url(url: str) -> Tuple[str, List[Song]]:
    """
    从歌单URL获取歌曲列表

    Returns:
        (歌单名称, 歌曲列表)
    """
    platform, playlist_id = parse_playlist_url(url)
    if not platform or not playlist_id:
        raise ValueError(f"无法识别此链接格式，请确认是网易云/QQ音乐/酷我/酷狗的歌单链接")

    fetcher = FETCHERS.get(platform)
    if not fetcher:
        raise ValueError(f"不支持的平台: {platform}")

    return fetcher(playlist_id)
