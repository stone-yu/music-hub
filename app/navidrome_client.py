"""
Navidrome (Subsonic API) 客户端
"""
import re
import hashlib
import random
import string
import logging
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
import requests

logger = logging.getLogger(__name__)


@dataclass
class NavidromeSong:
    id: str
    title: str
    artist: str
    album: str = ""

    @property
    def match_key(self) -> str:
        t = re.sub(r'[\s\-\(\)（）\[\]【】「」《》]', '', self.title.lower())
        a = re.sub(r'[\s\-\(\)（）\[\]【】「」《》]', '', self.artist.lower())
        t = re.sub(r'feat\.?|ft\.?|合唱|对唱|live|remix|cover|翻唱|伴奏', '', t)
        a = re.sub(r'feat\.?|ft\.?|&|、|，', '', a)
        return f"{t}|{a}"


class NavidromeClient:
    def __init__(self, base_url: str, username: str, password: str):
        self.base_url = base_url.rstrip('/')
        self.username = username
        self.password = password
        self._api_base = f"{self.base_url}/rest"

    def _make_params(self, extra: dict = None) -> dict:
        """构建认证参数"""
        salt = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
        token = hashlib.md5((self.password + salt).encode('utf-8')).hexdigest()
        params = {
            'u': self.username,
            't': token,
            's': salt,
            'v': '1.16.1',
            'c': 'navidrome-ai-playlist',
            'f': 'json',
        }
        if extra:
            params.update(extra)
        return params

    def _get(self, endpoint: str, extra_params: dict = None) -> Optional[dict]:
        url = f"{self._api_base}/{endpoint}"
        params = self._make_params(extra_params)
        try:
            resp = requests.get(url, params=params, timeout=30, verify=False)
            resp.raise_for_status()
            data = resp.json()
            response = data.get('subsonic-response', {})
            if response.get('status') == 'ok':
                return response
            else:
                error = response.get('error', {})
                logger.error(f"Navidrome API error: {error}")
                return None
        except Exception as e:
            logger.error(f"Navidrome request failed: {e}")
            return None

    def ping(self) -> bool:
        # 用短超时（5s）单独请求，避免 /api/status 在 Navidrome 不可达时卡 30s，
        # 让顶部连接状态指示灯能快速反馈“连接失败”。
        url = f"{self._api_base}/ping"
        params = self._make_params()
        try:
            resp = requests.get(url, params=params, timeout=5, verify=False)
            resp.raise_for_status()
            data = resp.json().get('subsonic-response', {})
            return data.get('status') == 'ok'
        except Exception as e:
            logger.warning(f"Navidrome ping 失败: {e}")
            return False

    def start_scan(self) -> bool:
        """触发 Navidrome 扫描音乐文件夹（索引新增文件）"""
        result = self._get('startScan')
        return result is not None

    def get_scan_status(self) -> dict:
        """查询扫描状态，返回 {scanning, count, folderCount, lastScan}"""
        result = self._get('getScanStatus')
        if not result:
            return {}
        return result.get('scanStatus', {})

    def get_all_artists(self) -> List[dict]:
        """获取所有艺术家"""
        result = self._get('getArtists')
        if not result:
            return []
        artists = []
        for index in result.get('artists', {}).get('index', []):
            for artist in index.get('artist', []):
                artists.append(artist)
        return artists

    def get_artist_songs(self, artist_id: str) -> List[NavidromeSong]:
        """获取某艺术家的所有歌曲"""
        result = self._get('getArtist', {'id': artist_id})
        if not result:
            return []
        songs = []
        artist_data = result.get('artist', {})
        artist_name = artist_data.get('name', '')
        for album in artist_data.get('album', []):
            album_result = self._get('getAlbum', {'id': album.get('id', '')})
            if album_result:
                for song_data in album_result.get('album', {}).get('song', []):
                    songs.append(NavidromeSong(
                        id=song_data.get('id', ''),
                        title=song_data.get('title', ''),
                        artist=song_data.get('artist', artist_name),
                        album=song_data.get('album', ''),
                    ))
        return songs

    def search_songs(self, query: str, count: int = 50) -> List[NavidromeSong]:
        """搜索歌曲"""
        result = self._get('search3', {'query': query, 'songCount': count})
        if not result:
            return []
        songs = []
        for song_data in result.get('searchResult3', {}).get('song', []):
            songs.append(NavidromeSong(
                id=song_data.get('id', ''),
                title=song_data.get('title', ''),
                artist=song_data.get('artist', ''),
                album=song_data.get('album', ''),
            ))
        return songs

    def get_all_songs(self) -> List[NavidromeSong]:
        """获取所有歌曲（通过遍历艺术家）"""
        all_songs = []
        artists = self.get_all_artists()
        logger.info(f"正在获取 {len(artists)} 位艺术家的歌曲...")
        for i, artist in enumerate(artists):
            songs = self.get_artist_songs(artist.get('id', ''))
            all_songs.extend(songs)
            if (i + 1) % 20 == 0:
                logger.info(f"已处理 {i+1}/{len(artists)} 位艺术家，累计 {len(all_songs)} 首歌曲")
        logger.info(f"共获取 {len(all_songs)} 首歌曲")
        return all_songs

    def get_playlists(self) -> List[dict]:
        """获取所有歌单"""
        result = self._get('getPlaylists')
        if not result:
            return []
        return result.get('playlists', {}).get('playlist', [])

    def get_playlist_songs(self, playlist_id: str) -> List[NavidromeSong]:
        """获取某歌单内的歌曲列表"""
        result = self._get('getPlaylist', {'id': playlist_id})
        if not result:
            return []
        songs = []
        for song_data in result.get('playlist', {}).get('entry', []):
            songs.append(NavidromeSong(
                id=song_data.get('id', ''),
                title=song_data.get('title', ''),
                artist=song_data.get('artist', ''),
                album=song_data.get('album', ''),
            ))
        return songs

    def add_to_playlist(self, playlist_id: str, song_ids: List[str]) -> dict:
        """将歌曲加入已有歌单，自动跳过已存在的歌曲。
        返回 {"added": N, "skipped": M}"""
        existing = {s.id for s in self.get_playlist_songs(playlist_id)}
        to_add = [sid for sid in song_ids if sid not in existing]
        if to_add:
            self._get('updatePlaylist', {
                'playlistId': playlist_id,
                'songIdToAdd': to_add,
            })
        return {"added": len(to_add), "skipped": len(song_ids) - len(to_add)}


    def create_playlist(self, name: str, song_ids: List[str], cover_data: bytes = None) -> Optional[dict]:
        """创建歌单，可选附带封面图"""
        if cover_data:
            # 使用 multipart form 上传带封面的歌单
            url = f"{self._api_base}/createPlaylist"
            params = self._make_params({'name': name})
            files = {'coverArt': ('cover.jpg', cover_data, 'image/jpeg')}
            try:
                resp = requests.post(url, params=params, files=files, timeout=30, verify=False)
                resp.raise_for_status()
                data = resp.json()
                response = data.get('subsonic-response', {})
                if response.get('status') != 'ok':
                    logger.error(f"Create playlist with cover failed: {response.get('error')}")
                    return None
                playlist = response.get('playlist', {})
            except Exception as e:
                logger.error(f"Create playlist with cover failed: {e}")
                return None
        else:
            result = self._get('createPlaylist', {'name': name})
            if not result:
                return None
            playlist = result.get('playlist', {})

        playlist_id = playlist.get('id', '')
        if song_ids:
            self._get('updatePlaylist', {
                'playlistId': playlist_id,
                'songIdToAdd': song_ids,
            })
        return playlist

    def delete_playlist(self, playlist_id: str) -> bool:
        """删除歌单"""
        result = self._get('deletePlaylist', {'id': playlist_id})
        return result is not None

    def get_cover_art(self, cover_id: str, size: int = 300) -> Optional[bytes]:
        """获取封面图二进制（getCoverArt）"""
        url = f"{self._api_base}/getCoverArt"
        params = self._make_params({'id': cover_id, 'size': size})
        try:
            resp = requests.get(url, params=params, timeout=30, verify=False)
            resp.raise_for_status()
            return resp.content
        except Exception as e:
            logger.warning(f"获取封面失败 {cover_id}: {e}")
            return None
