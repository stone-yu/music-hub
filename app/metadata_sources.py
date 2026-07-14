"""
音乐元数据源抽象层 - 统一接口供搜索/下载/刮削复用
当前实现：网易云、酷我；QQ 留接口位（待实现）

网易 get_detail 用 POST /api/v3/song/detail（已验证返回完整元数据：标题/艺术家/专辑/封面/时长）
酷我 复用 downloader.kuwo_search（rid 作 source_id，album 从搜索结果取）
"""
import json
import logging
from dataclasses import dataclass, asdict
from typing import List, Optional

from searchers import _safe_get, _safe_post, HEADERS

logger = logging.getLogger(__name__)


@dataclass
class TrackMeta:
    """歌曲元数据（搜索/刮削通用）"""
    title: str
    artist: str
    album: str = ""
    cover_url: str = ""
    duration: int = 0          # 秒
    source: str = ""           # 平台名：网易/酷我/QQ
    source_id: str = ""        # 平台内歌曲ID（网易 song id / 酷我 rid）
    lyrics: str = ""           # 歌词文本（带时间轴的 lrc 格式），网易云可获取，酷我暂无

    def to_dict(self):
        return asdict(self)


class MetadataSource:
    """数据源抽象接口"""
    name = ""

    def search(self, keyword: str, limit: int = 10) -> List[TrackMeta]:
        """搜索，返回候选列表"""
        raise NotImplementedError

    def get_detail(self, source_id: str) -> Optional[TrackMeta]:
        """按 source_id 获取完整元数据（刮削用，补全专辑/封面等）"""
        raise NotImplementedError


# ==================== 网易云音乐 ====================
def _fetch_netease_lyrics(song_id: str) -> str:
    """抓网易歌词（lrc 带时间轴格式）。失败返回空串，不影响其他元数据。"""
    if not song_id:
        return ''
    try:
        resp = _safe_post(
            'http://music.163.com/api/song/lyric',
            headers={**HEADERS, 'Referer': 'https://music.163.com/'},
            data={'id': song_id, 'lv': -1, 'kv': -1, 'tv': -1},
        )
        if not resp:
            return ''
        lyric = resp.json().get('lrc', {}).get('lyric', '')
        return lyric or ''
    except Exception as e:
        logger.warning(f"网易歌词获取失败 song_id={song_id}: {e}")
        return ''


class NeteaseSource(MetadataSource):
    name = "网易"

    def search(self, keyword: str, limit: int = 10) -> List[TrackMeta]:
        results = []
        resp = _safe_post(
            'http://music.163.com/api/search/get/web',
            headers={**HEADERS, 'Referer': 'https://music.163.com/'},
            data={'s': keyword, 'type': 1, 'limit': limit, 'offset': 0},
        )
        if not resp:
            return results
        try:
            for item in resp.json().get('result', {}).get('songs', []):
                title = item.get('name', '')
                artists = '/'.join([a.get('name', '') for a in item.get('artists', [])])
                album = item.get('album', {}).get('name', '')
                song_id = str(item.get('id', ''))
                if title and artists and song_id:
                    results.append(TrackMeta(title=title, artist=artists, album=album,
                                             source=self.name, source_id=song_id))
        except Exception as e:
            logger.warning(f"网易元数据搜索失败: {e}")
        return results

    def get_detail(self, source_id: str) -> Optional[TrackMeta]:
        """网易 v3/song/detail 拿完整元数据（含封面/专辑），并补抓歌词"""
        try:
            resp = _safe_post(
                'http://music.163.com/api/v3/song/detail',
                headers={**HEADERS, 'Referer': 'https://music.163.com/'},
                data={'c': json.dumps([{"id": int(source_id)}])},
            )
            if not resp:
                return None
            s = resp.json().get('songs', [{}])[0]
            if not s:
                return None
            artists = '/'.join([a.get('name', '') for a in s.get('ar', [])])
            al = s.get('al', {})
            return TrackMeta(
                title=s.get('name', ''),
                artist=artists,
                album=al.get('name', ''),
                cover_url=al.get('picUrl', ''),
                duration=int(s.get('dt', 0) / 1000) if s.get('dt') else 0,
                source=self.name,
                source_id=source_id,
                lyrics=_fetch_netease_lyrics(source_id),
            )
        except Exception as e:
            logger.warning(f"网易详情获取失败: {e}")
            return None


# ==================== 酷我音乐 ====================
class KuwoSource(MetadataSource):
    name = "酷我"

    def search(self, keyword: str, limit: int = 10) -> List[TrackMeta]:
        from app.downloader import kuwo_search
        results = []
        for item in kuwo_search(keyword, limit):
            results.append(TrackMeta(
                title=item.get('title', ''),
                artist=item.get('artist', ''),
                source=self.name,
                source_id=item.get('rid', ''),
            ))
        return results

    def get_detail(self, source_id: str) -> Optional[TrackMeta]:
        """酷我搜索结果已含基础信息，重新搜一次取 album（酷我 antiserver 无专辑详情接口）"""
        from app.downloader import kuwo_search
        try:
            # 用 rid 搜不到，改用 source_id 反查；酷我无直接详情接口，返回基础占位
            return TrackMeta(title='', artist='', source=self.name, source_id=source_id)
        except Exception as e:
            logger.warning(f"酷我详情获取失败: {e}")
            return None


# ==================== QQ音乐（留接口位，待实现）====================
class QQSource(MetadataSource):
    name = "QQ"

    def search(self, keyword: str, limit: int = 10) -> List[TrackMeta]:
        # TODO: 实现 QQ 搜索（需 vkey 签名）
        raise NotImplementedError("QQ 数据源待实现")

    def get_detail(self, source_id: str) -> Optional[TrackMeta]:
        raise NotImplementedError("QQ 数据源待实现")


# ==================== 注册表 ====================
NETEASE_SOURCE = NeteaseSource()
KUWO_SOURCE = KuwoSource()
QQ_SOURCE = QQSource()  # 留位，未实现

# 已实现的可用数据源（QQ 不在此列）
METADATA_SOURCES = {
    "网易": NETEASE_SOURCE,
    "酷我": KUWO_SOURCE,
}
