import { STREAM_EXTENSIONS } from '$lib/types';
import { loadTrackLyrics } from '$lib/services/lyrics';
import { loadEmbeddedStreamArtwork, loadTrackMetadata } from '$lib/services/stream-artwork';
import { inferArtistTitleFromFileName, inferExtension, stripFileExtension } from '$lib/utils/files';
import { EMPTY_TAGS, parseId3, type EditableTags } from './tag-writer';

const TAG_FIELDS: Array<Exclude<keyof EditableTags, 'lyrics'>> = [
  'title', 'artist', 'albumArtist', 'album', 'composer', 'genre', 'year', 'trackNumber', 'discNumber'
];

async function readMp3Tags(file: File, signal: AbortSignal) {
  const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  signal.throwIfAborted();
  if (header.length < 10 || header[0] !== 73 || header[1] !== 68 || header[2] !== 51) return null;
  const size = ((header[6] & 127) << 21) | ((header[7] & 127) << 14) | ((header[8] & 127) << 7) | (header[9] & 127);
  // Only the tag block is needed, never a second full-file read before decoding.
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 10 + size, 32 * 1024 * 1024)).arrayBuffer());
  signal.throwIfAborted();
  return parseId3(bytes);
}

/** Metadata is independent of decoding and must not prevent audio from opening. */
export async function loadEditorMetadata(file: File, signal: AbortSignal): Promise<{ tags: EditableTags; artwork: Blob | null }> {
  signal.throwIfAborted();
  const extension = inferExtension(file.name);
  let tags = { ...EMPTY_TAGS };
  let artwork: Blob | null = null;
  if ((STREAM_EXTENSIONS as readonly string[]).includes(extension)) {
    const track = {
      id: `editor:${file.name}:${file.size}:${file.lastModified}`, file, name: file.name,
      extension, kind: 'stream' as const, size: file.size, lastModified: file.lastModified
    };
    const [id3, metadata, embeddedArtwork, lyrics] = await Promise.allSettled([
      extension === 'mp3' ? readMp3Tags(file, signal) : Promise.resolve(null),
      loadTrackMetadata(track), loadEmbeddedStreamArtwork(track), loadTrackLyrics(track)
    ]);
    signal.throwIfAborted();
    if (id3.status === 'fulfilled' && id3.value) { tags = id3.value.tags; artwork = id3.value.artwork; }
    if (metadata.status === 'fulfilled' && metadata.value) {
      for (const key of TAG_FIELDS) tags[key] = metadata.value[key] ?? tags[key];
    }
    if (embeddedArtwork.status === 'fulfilled' && embeddedArtwork.value) artwork = embeddedArtwork.value.blob;
    if (lyrics.status === 'fulfilled' && lyrics.value) tags.lyrics = lyrics.value.raw;
  }
  const inferred = inferArtistTitleFromFileName(file.name);
  tags.title ||= inferred?.title || stripFileExtension(file.name);
  tags.artist ||= inferred?.artist || '';
  return { tags, artwork };
}
