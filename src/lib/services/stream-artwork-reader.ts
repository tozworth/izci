import { decodeBase64 } from './stream-meta-binary';
import { parsePictureBlock, type ParsedArtwork } from './stream-meta-flac';
import { findOggPacketRanges } from './stream-meta-ogg';
import { FileRangeReader } from './stream-meta-io';
import type { ReadFileBytes } from './media-file-reader';

const MAX_PICTURE_BYTES = 16 * 1024 * 1024;
const MAX_ENCODED_PICTURE_BYTES = Math.ceil(MAX_PICTURE_BYTES / 3) * 4 + 64;
const SCAN_LIMIT_BYTES = 64 * 1024 * 1024;

export async function readFlacArtwork(file: File, readBytes: ReadFileBytes): Promise<ParsedArtwork | null> {
  if (new TextDecoder().decode(await readBytes(0, 4)) !== 'fLaC') return null;
  let offset = 4;
  let fallback: ParsedArtwork | null = null;
  let pictureBytesRead = 0;
  for (let blocks = 0; blocks < 4096 && offset + 4 <= Math.min(file.size, SCAN_LIMIT_BYTES); blocks++) {
    const header = await readBytes(offset, 4);
    if (header.length !== 4) break;
    const length = (header[1] << 16) | (header[2] << 8) | header[3];
    offset += 4;
    if (offset + length > file.size) break;
    if ((header[0] & 0x7f) === 6 && length >= 32 && length <= MAX_PICTURE_BYTES) {
      const type = await readBytes(offset, 4);
      const front = type.length === 4 && new DataView(type.buffer, type.byteOffset, 4).getUint32(0) === 3;
      if ((front || !fallback) && pictureBytesRead + length <= MAX_PICTURE_BYTES * 2) {
        pictureBytesRead += length;
        const artwork = parsePictureBlock(await readBytes(offset, length));
        if (artwork?.data.length) {
          if (front) return artwork;
          fallback = artwork;
        }
      }
    }
    offset += length;
    if (header[0] & 0x80) break;
  }
  return fallback;
}

export async function readOpusArtwork(file: File, readBytes: ReadFileBytes): Promise<ParsedArtwork | null> {
  const packet = await findOggPacketRanges(file, 1, { readBytes, scanLimitBytes: SCAN_LIMIT_BYTES });
  if (!packet) return null;
  const reader = new FileRangeReader(packet.ranges, readBytes);
  const prefix = await reader.read(8);
  if (!prefix || new TextDecoder().decode(prefix) !== 'OpusTags') return null;
  const vendorLength = await reader.readUint32LE();
  if (vendorLength === null || !reader.skip(vendorLength)) return null;
  const count = await reader.readUint32LE();
  if (count === null) return null;
  let pictureBytesRead = 0;
  for (let index = 0; index < count && reader.remaining >= 4; index++) {
    const length = await reader.readUint32LE();
    if (length === null || length > reader.remaining) break;
    const probe = await reader.read(Math.min(length, 64));
    if (!probe) break;
    const separator = probe.indexOf(0x3d);
    const key = separator > 0 ? new TextDecoder().decode(probe.subarray(0, separator)).trim().toUpperCase() : '';
    const remaining = length - probe.length;
    if (key !== 'METADATA_BLOCK_PICTURE' || length > MAX_ENCODED_PICTURE_BYTES
      || pictureBytesRead + length > MAX_ENCODED_PICTURE_BYTES * 2) {
      reader.skip(remaining);
      continue;
    }
    pictureBytesRead += length;
    const tail = await reader.read(remaining);
    if (!tail) break;
    const value = new TextDecoder().decode(probe.subarray(separator + 1)) + new TextDecoder().decode(tail);
    const decoded = decodeBase64(value.trim());
    const artwork = decoded && decoded.length <= MAX_PICTURE_BYTES ? parsePictureBlock(decoded) : null;
    if (artwork?.data.length) return artwork;
  }
  return null;
}
