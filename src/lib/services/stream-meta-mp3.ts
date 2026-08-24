import type { TrackMetadata } from '$lib/types';

import { readSynchsafeUint32, readUint32BE } from './stream-meta-binary';
import { applyReplayGainComment } from './stream-meta-replaygain';

const ID3_MARKER = 'ID3';

function parseId3UserTextFrame(frameData: Uint8Array, metadata: TrackMetadata): void {
  if (frameData.byteLength < 2) {
    return;
  }

  const encoding = frameData[0];
  const text = decodeTextBytes(frameData.subarray(1), encoding);
  const parts = text.split(/\u0000+/);
  const key = parts[0]?.trim();
  const value = parts.slice(1).join('\u0000').trim();

  if (!key || !value) {
    return;
  }

  applyReplayGainComment(metadata, key, value);
}

function parseId3v2ReplayGain(bytes: Uint8Array, metadata: TrackMetadata): void {
  if (bytes.byteLength < 10 || new TextDecoder().decode(bytes.subarray(0, 3)) !== ID3_MARKER) {
    return;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const majorVersion = view.getUint8(3);

  if (majorVersion < 3 || majorVersion > 4) {
    return;
  }

  const flags = view.getUint8(5);
  const tagSize = readSynchsafeUint32(view, 6);
  const tagEnd = Math.min(10 + tagSize, bytes.byteLength);
  let offset = 10;

  if ((flags & 0x40) !== 0 && offset + 4 <= tagEnd) {
    const extendedHeaderSize = majorVersion === 4 ? readSynchsafeUint32(view, offset) : readUint32BE(view, offset);
    offset += majorVersion === 4 ? extendedHeaderSize : extendedHeaderSize + 4;
  }

  while (offset + 10 <= tagEnd) {
    const frameId = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
    const frameSize = majorVersion === 4 ? readSynchsafeUint32(view, offset + 4) : readUint32BE(view, offset + 4);
    const frameDataStart = offset + 10;
    const frameDataEnd = frameDataStart + frameSize;

    if (!/^[A-Z0-9]{4}$/.test(frameId) || frameSize <= 0 || frameDataEnd > tagEnd) {
      break;
    }

    if (frameId === 'TXXX') {
      parseId3UserTextFrame(bytes.subarray(frameDataStart, frameDataEnd), metadata);
    }

    offset = frameDataEnd;
  }
}

function findApeFooterOffset(bytes: Uint8Array): number {
  const decoder = new TextDecoder();
  let footerOffset = bytes.byteLength - 32;

  if (bytes.byteLength >= 160 && decoder.decode(bytes.subarray(bytes.byteLength - 128, bytes.byteLength - 125)) === 'TAG') {
    footerOffset -= 128;
  }

  return footerOffset >= 0 && decoder.decode(bytes.subarray(footerOffset, footerOffset + 8)) === 'APETAGEX'
    ? footerOffset
    : -1;
}

function parseApeReplayGain(bytes: Uint8Array, metadata: TrackMetadata): void {
  const footerOffset = findApeFooterOffset(bytes);

  if (footerOffset < 0) {
    return;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tagSize = view.getUint32(footerOffset + 12, true);
  const itemCount = view.getUint32(footerOffset + 16, true);
  const tagStart = footerOffset - tagSize + 32;

  if (tagSize < 32 || itemCount <= 0 || tagStart < 0) {
    return;
  }

  let offset = tagStart;

  for (let index = 0; index < itemCount && offset + 8 <= footerOffset; index += 1) {
    const valueSize = view.getUint32(offset, true);
    const flags = view.getUint32(offset + 4, true);
    const keyStart = offset + 8;
    let keyEnd = keyStart;

    while (keyEnd < footerOffset && bytes[keyEnd] !== 0) {
      keyEnd += 1;
    }

    const valueStart = keyEnd + 1;
    const valueEnd = valueStart + valueSize;

    if (keyEnd >= footerOffset || valueEnd > footerOffset) {
      break;
    }

    const itemType = (flags >> 1) & 0x03;

    if (itemType === 0) {
      const key = new TextDecoder('iso-8859-1').decode(bytes.subarray(keyStart, keyEnd));
      const value = new TextDecoder('utf-8').decode(bytes.subarray(valueStart, valueEnd));
      applyReplayGainComment(metadata, key, value);
    }

    offset = valueEnd;
  }
}

function parseMp3Data(bytes: Uint8Array): TrackMetadata {
  const metadata: TrackMetadata = {};

  parseId3v2ReplayGain(bytes, metadata);
  parseApeReplayGain(bytes, metadata);

  return metadata;
}

export function readMp3Metadata(
  file: File,
  options: { readBytes(offset: number, length: number): Promise<Uint8Array>; maxHeadBytes: number; tailBytes: number }
): Promise<TrackMetadata> {
  return readMp3MetadataImpl(file, options);
}

async function readMp3MetadataImpl(
  file: File,
  options: { readBytes(offset: number, length: number): Promise<Uint8Array>; maxHeadBytes: number; tailBytes: number }
): Promise<TrackMetadata> {
  const header = await options.readBytes(0, Math.min(file.size, 10));
  let headMetadata: TrackMetadata = {};
  let headLength = header.byteLength;

  if (header.byteLength === 10 && new TextDecoder().decode(header.subarray(0, 3)) === ID3_MARKER) {
    headLength = Math.min(file.size, 10 + readSynchsafeUint32(new DataView(header.buffer), 6), options.maxHeadBytes);
    headMetadata = parseMp3Data(await options.readBytes(0, headLength));
  }

  const tailLength = Math.min(file.size, options.tailBytes);
  if (tailLength === 0 || (tailLength === file.size && headLength === file.size)) return headMetadata;

  const tail = await options.readBytes(file.size - tailLength, tailLength);
  return mergeTrackMetadata(headMetadata, parseMp3Data(tail));
}

function decodeTextBytes(bytes: Uint8Array, encoding: number): string {
  const labels: Record<number, string> = {
    0: 'iso-8859-1',
    1: 'utf-16',
    2: 'utf-16be',
    3: 'utf-8'
  };

  try {
    return new TextDecoder(labels[encoding] ?? 'iso-8859-1').decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function mergeTrackMetadata(first: TrackMetadata, second: TrackMetadata): TrackMetadata {
  return {
    ...first,
    ...second,
    replayGain:
      first.replayGain || second.replayGain
        ? { ...first.replayGain, ...second.replayGain }
        : undefined
  };
}
