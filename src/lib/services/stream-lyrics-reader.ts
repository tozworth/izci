import type { ReadFileBytes } from './media-file-reader';
import { FileRangeReader } from './stream-meta-io';
import { findOggPacketRanges } from './stream-meta-ogg';
import type { VorbisComment } from './stream-meta-flac';

const LYRICS_KEYS = ['LYRICS', 'SYNCEDLYRICS', 'SYNCED LYRICS'];
export const MAX_EMBEDDED_LYRICS_BYTES = 1024 * 1024;
const SCAN_LIMIT_BYTES = 64 * 1024 * 1024;

async function readComments(reader: FileRangeReader): Promise<VorbisComment[]> {
  const vendor = await reader.readUint32LE();
  if (vendor === null || !reader.skip(vendor)) return [];
  const count = await reader.readUint32LE();
  if (count === null) return [];
  const comments: VorbisComment[] = [];
  for (let index = 0; index < count && reader.remaining >= 4; index++) {
    const length = await reader.readUint32LE();
    if (length === null || length > reader.remaining) break;
    const probe = await reader.read(Math.min(length, 64));
    if (!probe) break;
    const separator = probe.indexOf(0x3d);
    const key = separator > 0 ? new TextDecoder().decode(probe.subarray(0, separator)).trim().toUpperCase() : '';
    const remaining = length - probe.length;
    if (!LYRICS_KEYS.includes(key) || length > MAX_EMBEDDED_LYRICS_BYTES || comments.some(c => c.key === key)) {
      reader.skip(remaining);
      continue;
    }
    const tail = await reader.read(remaining);
    if (!tail) break;
    comments.push({ key, value: new TextDecoder().decode(probe.subarray(separator + 1)) + new TextDecoder().decode(tail) });
  }
  return comments;
}

// Null means this container was not recognized and the generic metadata reader
// can try it. An empty string means recognized but no supported lyrics: avoid
// another parser reading all the artwork/comments that were deliberately skipped.
export async function readStreamLyrics(file: File, extension: string, readBytes: ReadFileBytes): Promise<string | null> {
  const comments: VorbisComment[] = [];
  if (extension === 'flac') {
    if (new TextDecoder().decode(await readBytes(0, 4)) !== 'fLaC') return null;
    let offset = 4;
    for (let blocks = 0; blocks < 4096 && offset + 4 <= Math.min(file.size, SCAN_LIMIT_BYTES); blocks++) {
      const header = await readBytes(offset, 4);
      if (header.length !== 4) break;
      const length = (header[1] << 16) | (header[2] << 8) | header[3];
      offset += 4;
      if (offset + length > file.size || offset + length > SCAN_LIMIT_BYTES) break;
      if ((header[0] & 0x7f) === 4) {
        const found = await readComments(new FileRangeReader([{ offset, length }], readBytes));
        for (const comment of found) if (!comments.some(c => c.key === comment.key)) comments.push(comment);
      }
      offset += length;
      if (header[0] & 0x80) break;
    }
  } else if (extension === 'opus' || extension === 'ogg') {
    const packet = await findOggPacketRanges(file, 1, { readBytes, scanLimitBytes: SCAN_LIMIT_BYTES });
    if (!packet) return null;
    const reader = new FileRangeReader(packet.ranges, readBytes);
    const expected = extension === 'opus' ? new TextEncoder().encode('OpusTags')
      : new Uint8Array([3, ...new TextEncoder().encode('vorbis')]);
    const prefix = await reader.read(expected.length);
    if (!prefix || prefix.some((value, index) => value !== expected[index])) return null;
    comments.push(...await readComments(reader));
  } else {
    return null;
  }
  for (const key of LYRICS_KEYS) {
    const value = comments.find(c => c.key === key)?.value.trim();
    if (value) return value;
  }
  return '';
}
