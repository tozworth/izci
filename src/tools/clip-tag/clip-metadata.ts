import type { MetadataTags } from 'mediabunny';
import type { ClipExportFormat } from './clip-export-options';
import type { EditableTags } from './tag-writer';

function parsePosition(value: string): { number?: number; total?: number } {
  const [numberText, totalText] = value.split('/', 2);
  const number = Number.parseInt(numberText, 10);
  const total = Number.parseInt(totalText ?? '', 10);
  return {
    number: Number.isFinite(number) && number > 0 ? number : undefined,
    total: Number.isFinite(total) && total > 0 ? total : undefined
  };
}

export async function editableTagsToMetadata(
  tags: EditableTags,
  artwork: Blob | null,
  format: ClipExportFormat = 'flac'
): Promise<MetadataTags> {
  const track = parsePosition(tags.trackNumber);
  const disc = parsePosition(tags.discNumber);
  const year = Number.parseInt(tags.year, 10);
  return {
    title: tags.title.trim() || undefined,
    artist: tags.artist.trim() || undefined,
    album: tags.album.trim() || undefined,
    albumArtist: tags.albumArtist.trim() || undefined,
    genre: tags.genre.trim() || undefined,
    trackNumber: track.number,
    tracksTotal: track.total,
    discNumber: disc.number,
    discsTotal: disc.total,
    date: Number.isFinite(year) && year > 0 ? new Date(Date.UTC(year, 0, 1)) : undefined,
    images: artwork
      ? [{
          data: new Uint8Array(await artwork.arrayBuffer()),
          mimeType: artwork.type || 'image/jpeg',
          kind: 'coverFront'
        }]
      : undefined,
    raw: tags.composer.trim()
      ? { [format === 'mp3' || format === 'wav' ? 'TCOM' : 'COMPOSER']: tags.composer.trim() }
      : undefined
  };
}
