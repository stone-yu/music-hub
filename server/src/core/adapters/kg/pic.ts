/**
 * kg 封面适配器 — 移植自上游 src/renderer/utils/musicSdk/kg/pic.js@9c364b4
 * POST get_res_privilege，取 info.image（{size} 占位替换为实际尺寸）。
 */
import { httpFetch } from '../http.js'
import type { MusicInfo } from '../common.js'

const KG_HEADERS = {
  'KG-RC': '1',
  'KG-THash': 'expand_search_manager.cpp:852736169:451',
  'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
}

export async function getKgPic(songInfo: MusicInfo): Promise<string | null> {
  const songmid = String(songInfo.songmid)
  const albumAudioId =
    songmid.length === 32 // 修复歌曲ID存储变更导致图片获取失败的问题
      ? (songInfo as { audioId?: string }).audioId?.split('_')[0]
      : songmid
  const body = {
    appid: 1001,
    area_code: '1',
    behavior: 'play',
    clientver: '9020',
    need_hash_offset: 1,
    relate: 1,
    resource: [
      {
        album_audio_id: albumAudioId,
        album_id: songInfo.albumId,
        hash: songInfo.hash,
        id: 0,
        name: `${songInfo.singer} - ${songInfo.name}.mp3`,
        type: 'audio',
      },
    ],
    token: '',
    userid: 2626431536,
    vip: 1,
  }
  const { body: resp } = await httpFetch<{
    error_code: number
    data: { info: { image?: string; imgsize?: number[] } }[]
  }>('http://media.store.kugou.com/v1/get_res_privilege', { method: 'post', headers: KG_HEADERS, body }).promise
  if (resp.error_code !== 0) return null
  const info = resp.data?.[0]?.info
  if (!info) return null
  const img = info.imgsize ? info.image?.replace('{size}', String(info.imgsize[0])) : info.image
  return img || null
}

export default { getPic: getKgPic }
