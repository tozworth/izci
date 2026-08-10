/**
 * Minimal Matroska/WebM structural parser: splits a WebM byte stream produced by
 * Mediabunny into a MediaSource init segment plus timestamped clusters.
 *
 * The parser only walks top-level Segment children (Info/Tracks/Cluster...) and
 * reads the Cluster Timecode. It deliberately stays unaware of codec payloads.
 */

export interface WebmClusterSlice {
  index: number;
  timeMs: number;
  /** Byte range inside the original buffer. */
  start: number;
  end: number;
}

export interface WebmSplit {
  /** EBML header + Segment + SeekHead + Info + Tracks (everything before the first Cluster). */
  initStart: number;
  initEnd: number;
  clusters: WebmClusterSlice[];
  durationMs: number;
}

const EBML_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const INFO_ID = 0x1549a966;
const TRACKS_ID = 0x1654ae6b;
const CLUSTER_ID = 0x1f43b675;
const TIMECODE_ID = 0xe7;
const DURATION_ID = 0x4489;
const TIMECODE_SCALE_ID = 0x2ad7b1;
const DEFAULT_TIMECODE_SCALE = 1_000_000;

export function splitWebm(bytes: Uint8Array): WebmSplit | null {
  const cursor = { offset: 0 };
  const ebml = readElement(bytes, cursor);
  if (!ebml || ebml.id !== EBML_ID) return null;

  const segment = readElement(bytes, cursor);
  if (!segment || segment.id !== SEGMENT_ID) return null;

  const children: Array<{ id: number; start: number; dataStart: number; end: number }> = [];
  const clusterStart = segment.start;
  const segmentEnd = segment.size === null
    ? bytes.length
    : Math.min(bytes.length, clusterStart + segment.size);

  let offset = clusterStart;
  while (offset + 1 < segmentEnd) {
    const elementStart = offset;
    const child = readElement(bytes, { offset });
    if (!child) break;
    if (child.end > segmentEnd) break;
    children.push({ id: child.id, start: elementStart, dataStart: child.start, end: child.end });
    offset = child.end;
    if (offset >= segmentEnd) break;
  }

  const firstClusterIndex = children.findIndex((child) => child.id === CLUSTER_ID);
  if (firstClusterIndex < 0) return null;

  let initEnd = segment.start;
  for (let index = 0; index < firstClusterIndex; index += 1) {
    initEnd = Math.max(initEnd, children[index].end);
  }

  let durationMs = 0;
  for (const child of children) {
    if (child.id === INFO_ID) {
      durationMs = readInfoDuration(bytes, child.dataStart, child.end);
      break;
    }
  }

  const clusters: WebmClusterSlice[] = [];
  let clusterIndex = 0;
  let estimatedTimeMs = 0;
  for (const child of children) {
    if (child.id !== CLUSTER_ID) continue;
    const timeMs = readClusterTimecode(bytes, child.dataStart, child.end) ?? estimatedTimeMs;
    estimatedTimeMs = timeMs + 1;
    clusters.push({ index: clusterIndex, timeMs, start: child.start, end: child.end });
    clusterIndex += 1;
  }

  return {
    initStart: 0,
    initEnd,
    clusters,
    durationMs
  };
}

export function sliceBytes(bytes: Uint8Array, start: number, end: number): ArrayBuffer {
  return bytes.buffer.slice(start, end) as ArrayBuffer;
}

interface ParsedElement {
  id: number;
  /** Byte offset of the element data. */
  start: number;
  /** Byte offset just past the element (data + header). */
  end: number;
  headerLength: number;
  size: number | null;
}

function readElement(bytes: Uint8Array, cursor: { offset: number }): ParsedElement | null {
  const idResult = readVintId(bytes, cursor.offset);
  if (!idResult) return null;
  const { id, idLength } = idResult;
  const sizeResult = readVintSize(bytes, cursor.offset + idLength);
  if (sizeResult === null) return null;
  const { size, sizeLength } = sizeResult;
  const headerLength = idLength + sizeLength;
  const start = cursor.offset + headerLength;
  const end = size === null ? bytes.length : start + size;
  if (end > bytes.length) return null;
  cursor.offset = end;
  return { id, start, end, headerLength, size };
}

function readVintId(bytes: Uint8Array, offset: number): { id: number; idLength: number } | null {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  if (first === 0) return null;
  let length = 1;
  for (let mask = 0x80; mask > 0 && (first & mask) === 0; mask >>= 1) length += 1;
  if (length > 4 || offset + length > bytes.length) return null;
  let id = 0;
  for (let index = 0; index < length; index += 1) {
    id = (id << 8) | bytes[offset + index];
  }
  return { id, idLength: length };
}

function readVintSize(
  bytes: Uint8Array,
  offset: number
): { size: number | null; sizeLength: number } | null {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  let length = 1;
  for (let mask = 0x80; mask > 0 && (first & mask) === 0; mask >>= 1) length += 1;
  if (length > 8 || offset + length > bytes.length) return null;
  let value = first & (0xff >> length);
  for (let index = 1; index < length; index += 1) {
    value = (value << 8) | bytes[offset + index];
  }
  const unknownSize = value === (1 << (7 * length)) - 1;
  return { size: unknownSize ? null : value, sizeLength: length };
}

function readClusterTimecode(bytes: Uint8Array, start: number, end: number): number | null {
  const cursor = { offset: start };
  while (cursor.offset + 1 < end) {
    const element = readElement(bytes, cursor);
    if (!element || element.end > end) return null;
    if (element.id === TIMECODE_ID) {
      const value = readUint(bytes, element.start, element.end);
      return value === null ? null : value;
    }
    if (element.id === 0xab || element.id === 0xa3) {
      // SimpleBlock / Block appear after Timecode; stop looking past them.
      return null;
    }
  }
  return null;
}

function readInfoDuration(bytes: Uint8Array, start: number, end: number): number {
  let timecodeScale = DEFAULT_TIMECODE_SCALE;
  let duration = 0;
  const cursor = { offset: start };
  while (cursor.offset + 1 < end) {
    const element = readElement(bytes, cursor);
    if (!element || element.end > end) break;
    if (element.id === TIMECODE_SCALE_ID) {
      timecodeScale = readUint(bytes, element.start, element.end) ?? DEFAULT_TIMECODE_SCALE;
    } else if (element.id === DURATION_ID) {
      duration = readFloat(bytes, element.start, element.end) ?? 0;
    }
  }
  return timecodeScale > 0 ? (duration * timecodeScale) / 1_000_000 : 0;
}

function readUint(bytes: Uint8Array, start: number, end: number): number | null {
  const length = end - start;
  if (length < 1 || length > 6) return null;
  let value = 0;
  for (let index = start; index < end; index += 1) value = value * 256 + bytes[index];
  return value;
}

function readFloat(bytes: Uint8Array, start: number, end: number): number | null {
  const length = end - start;
  if (length === 4) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + start, 4);
    return view.getFloat32(0, false);
  }
  if (length === 8) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + start, 8);
    return view.getFloat64(0, false);
  }
  return null;
}
