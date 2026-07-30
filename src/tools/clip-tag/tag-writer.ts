export interface EditableTags {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  composer: string;
  genre: string;
  year: string;
  trackNumber: string;
  discNumber: string;
}

export interface ParsedTags {
  tags: EditableTags;
  artwork: Blob | null;
}

export const EMPTY_TAGS: EditableTags = {
  title: '',
  artist: '',
  album: '',
  albumArtist: '',
  composer: '',
  genre: '',
  year: '',
  trackNumber: '',
  discNumber: ''
};

const FRAME_TO_FIELD: Record<string, keyof EditableTags> = {
  TIT2: 'title',
  TPE1: 'artist',
  TALB: 'album',
  TPE2: 'albumArtist',
  TCOM: 'composer',
  TCON: 'genre',
  TYER: 'year',
  TDRC: 'year',
  TRCK: 'trackNumber',
  TPOS: 'discNumber'
};

function synchsafe(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function encodeSynchsafe(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f
  ]);
}

function encodeUint32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ]);
}

function decodeText(data: Uint8Array): string {
  if (data.byteLength === 0) return '';
  const encoding = data[0];
  const payload = data.subarray(1);
  try {
    if (encoding === 1) return new TextDecoder('utf-16').decode(payload).replace(/\0+$/g, '').trim();
    if (encoding === 2) return new TextDecoder('utf-16be').decode(payload).replace(/\0+$/g, '').trim();
    if (encoding === 3) return new TextDecoder().decode(payload).replace(/\0+$/g, '').trim();
    return new TextDecoder('iso-8859-1').decode(payload).replace(/\0+$/g, '').trim();
  } catch {
    return new TextDecoder().decode(payload).replace(/\0+$/g, '').trim();
  }
}

function findZero(bytes: Uint8Array, start: number): number {
  for (let index = start; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 0) return index;
  }
  return bytes.byteLength;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function parseId3(fileBytes: Uint8Array): ParsedTags {
  const tags = { ...EMPTY_TAGS };
  if (fileBytes.byteLength < 10 || String.fromCharCode(...fileBytes.subarray(0, 3)) !== 'ID3') {
    return { tags, artwork: null };
  }
  const version = fileBytes[3];
  const tagEnd = Math.min(fileBytes.byteLength, 10 + synchsafe(fileBytes, 6));
  let offset = 10;
  let artwork: Blob | null = null;

  while (offset + 10 <= tagEnd) {
    const frameId = String.fromCharCode(...fileBytes.subarray(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
    const frameSize = version === 4 ? synchsafe(fileBytes, offset + 4) : uint32(fileBytes, offset + 4);
    const dataStart = offset + 10;
    const dataEnd = dataStart + frameSize;
    if (frameSize <= 0 || dataEnd > tagEnd) break;
    const field = FRAME_TO_FIELD[frameId];
    if (field) tags[field] = decodeText(fileBytes.subarray(dataStart, dataEnd));

    if (frameId === 'APIC' && frameSize > 4) {
      const frame = fileBytes.subarray(dataStart, dataEnd);
      const mimeEnd = findZero(frame, 1);
      const mime = new TextDecoder('iso-8859-1').decode(frame.subarray(1, mimeEnd));
      const descriptionStart = Math.min(mimeEnd + 2, frame.byteLength);
      const imageStart = Math.min(findZero(frame, descriptionStart) + 1, frame.byteLength);
      if (imageStart < frame.byteLength) artwork = new Blob([toArrayBuffer(frame.subarray(imageStart))], { type: mime || 'image/jpeg' });
    }
    offset = dataEnd;
  }

  return { tags, artwork };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function frame(id: string, payload: Uint8Array): Uint8Array {
  return concat([
    new TextEncoder().encode(id),
    encodeSynchsafe(payload.byteLength),
    new Uint8Array(2),
    payload
  ]);
}

function textFrame(id: string, value: string): Uint8Array | null {
  const normalized = value.trim();
  if (!normalized) return null;
  return frame(id, concat([new Uint8Array([3]), new TextEncoder().encode(normalized)]));
}

export async function buildId3Tag(
  tags: EditableTags,
  artwork: Blob | null,
  preservedFrames: Uint8Array[] = []
): Promise<Uint8Array> {
  const frames: Uint8Array[] = [...preservedFrames];
  const values: Array<[string, string]> = [
    ['TIT2', tags.title],
    ['TPE1', tags.artist],
    ['TALB', tags.album],
    ['TPE2', tags.albumArtist],
    ['TCOM', tags.composer],
    ['TCON', tags.genre],
    ['TDRC', tags.year],
    ['TRCK', tags.trackNumber],
    ['TPOS', tags.discNumber]
  ];
  for (const [id, value] of values) {
    const next = textFrame(id, value);
    if (next) frames.push(next);
  }

  if (artwork) {
    const mime = new TextEncoder().encode(artwork.type || 'image/jpeg');
    const image = new Uint8Array(await artwork.arrayBuffer());
    frames.push(frame('APIC', concat([
      new Uint8Array([3]),
      mime,
      new Uint8Array([0, 3, 0]),
      image
    ])));
  }

  const body = concat(frames);
  return concat([
    new TextEncoder().encode('ID3'),
    new Uint8Array([4, 0, 0]),
    encodeSynchsafe(body.byteLength),
    body
  ]);
}

export async function tagMp3(source: File, tags: EditableTags, artwork: Blob | null): Promise<Blob> {
  const bytes = new Uint8Array(await source.arrayBuffer());
  const audioStart = bytes.byteLength >= 10 && String.fromCharCode(...bytes.subarray(0, 3)) === 'ID3'
    ? Math.min(bytes.byteLength, 10 + synchsafe(bytes, 6))
    : 0;
  const tag = await buildId3Tag(tags, artwork, extractPreservedFrames(bytes));
  return new Blob([toArrayBuffer(tag), toArrayBuffer(bytes.subarray(audioStart))], { type: 'audio/mpeg' });
}

function extractPreservedFrames(bytes: Uint8Array): Uint8Array[] {
  if (bytes.byteLength < 10 || String.fromCharCode(...bytes.subarray(0, 3)) !== 'ID3') return [];
  const version = bytes[3];
  const tagEnd = Math.min(bytes.byteLength, 10 + synchsafe(bytes, 6));
  const managedIds = new Set([...Object.keys(FRAME_TO_FIELD), 'APIC']);
  const preserved: Uint8Array[] = [];
  let offset = 10;

  while (offset + 10 <= tagEnd) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = version === 4 ? synchsafe(bytes, offset + 4) : uint32(bytes, offset + 4);
    const payloadStart = offset + 10;
    const payloadEnd = payloadStart + size;
    if (size <= 0 || payloadEnd > tagEnd) break;
    if (!managedIds.has(id)) preserved.push(frame(id, bytes.slice(payloadStart, payloadEnd)));
    offset = payloadEnd;
  }

  return preserved;
}
