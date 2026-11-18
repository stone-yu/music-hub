import type { NavidromeSong } from '../navidrome/client.js'

export interface LibraryProgress {
  phase: 'scan' | 'artists' | 'songs'
  processedArtists: number
  totalArtists: number
  songsRead: number
}

interface LibrarySource {
  getArtists(): Promise<any[]>
  getArtist(id: string): Promise<any | null>
  getAlbum(id: string): Promise<any | null>
}

/** Report completed artist traversals, not an estimated song total. */
export async function readLibrarySongs(source: LibrarySource, report: (progress: LibraryProgress) => void = () => {}): Promise<NavidromeSong[]> {
  report({ phase: 'artists', processedArtists: 0, totalArtists: 0, songsRead: 0 })
  const artists = await source.getArtists()
  const songs: NavidromeSong[] = []
  report({ phase: 'songs', processedArtists: 0, totalArtists: artists.length, songsRead: 0 })
  for (let i = 0; i < artists.length; i++) {
    const artistData = await source.getArtist(artists[i].id)
    for (const album of artistData?.artist?.album ?? []) {
      const albumData = await source.getAlbum(album.id)
      for (const s of albumData?.album?.song ?? []) {
        songs.push({
          id: String(s.id ?? ''),
          title: s.title ?? '',
          artist: s.artist ?? artistData.artist.name ?? '',
          album: s.album ?? album.name ?? '',
          coverArt: String(s.coverArt ?? albumData.album.coverArt ?? '') || undefined,
          duration: typeof s.duration === 'number' ? s.duration : undefined,
          suffix: typeof s.suffix === 'string' ? s.suffix : undefined,
          playCount: typeof s.playCount === 'number' ? s.playCount : undefined,
          created: typeof s.created === 'string' ? s.created : undefined,
        })
      }
      // Show song counts even if one artist has many albums; percent only advances after artist completion.
      report({ phase: 'songs', processedArtists: i, totalArtists: artists.length, songsRead: songs.length })
    }
    report({ phase: 'songs', processedArtists: i + 1, totalArtists: artists.length, songsRead: songs.length })
  }
  return songs
}
