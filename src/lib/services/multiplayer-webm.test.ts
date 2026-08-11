import { describe, expect, it } from 'vitest';
import { splitWebm } from './multiplayer-webm';

function vintId(id: number): number[] {
  const bytes: number[] = [];
  let value = id;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>>= 8;
  }
  // IDs keep their marker bit in the first byte; Matroska element IDs are 1-4 bytes.
  const length = bytes.length;
  bytes[0] = (bytes[0] ?? 0) | (0x80 >> (length - 1));
  return bytes;
}

function vintSize(size: number): number[] {
  // Choose the smallest vint that can hold the size.
  let length = 1;
  while (size >= 1 << (7 * length)) length += 1;
  const bytes: number[] = [];
  let value = size;
  for (let index = 0; index < length; index += 1) {
    bytes.unshift(value & 0xff);
    value >>>= 8;
  }
  bytes[0] = (bytes[0] ?? 0) | (0x80 >> (length - 1));
  return bytes;
}

function element(id: number, data: number[]): number[] {
  return [...vintId(id), ...vintSize(data.length), ...data];
}

function uintBytes(value: number): number[] {
  const bytes: number[] = [];
  let current = value;
  while (current > 0) {
    bytes.unshift(current & 0xff);
    current >>>= 8;
  }
  return bytes.length > 0 ? bytes : [0];
}

function float64Bytes(value: number): number[] {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, false);
  return Array.from(new Uint8Array(buffer));
}

function buildWebm(clusterTimecodes: number[], durationTimecodeUnits: number): Uint8Array {
  const ebml = element(0x1a45dfa3, [
    ...element(0x4282, [0x77, 0x65, 0x62, 0x6d]) // DocType "webm"
  ]);
  const info = element(0x1549a966, [
    ...element(0x2ad7b1, uintBytes(1_000_000)), // TimecodeScale (ns per unit; 1e6 = 1 ms)
    ...element(0x4489, float64Bytes(durationTimecodeUnits)) // Duration in timecode units
  ]);
  const tracks = element(0x1654ae6b, [
    ...element(0xae, [
      ...element(0x83, [0x00]), // TrackNumber
      ...element(0x86, [0x01]), // TrackType audio
      ...element(0x88, [0x80]), // CodecID "A_OPUS"
      ...element(0x23e383, uintBytes(48_000)), // SamplingFrequency
      ...element(0x9f, uintBytes(2)) // Channels
    ])
  ]);
  const clusters = clusterTimecodes.map((timeMs) => element(0x1f43b675, [
    ...element(0xe7, uintBytes(timeMs)), // Timecode
    ...element(0xa3, [0x81, 0x00, 0x00, 0x00]) // SimpleBlock placeholder
  ]).map((byte) => {
    // Keep track of cluster byte positions in a parallel array via closure below.
    return byte;
  }));

  const segmentChildren = [...info, ...tracks];
  for (const cluster of clusters) segmentChildren.push(...cluster);
  const segment = element(0x18538067, segmentChildren);

  const bytes = [...ebml, ...segment];
  const result = new Uint8Array(bytes.length);
  result.set(bytes);
  return result;
}

describe('splitWebm', () => {
  it('splits a WebM into init and timestamped clusters', () => {
    const webm = buildWebm([0, 1000, 2000], 3500); // 3.5 s at 1 ms timecode units
    const split = splitWebm(webm);
    expect(split).not.toBeNull();
    expect(split!.durationMs).toBeCloseTo(3500, 1);

    expect(split!.clusters).toHaveLength(3);
    expect(split!.clusters.map((cluster) => cluster.timeMs)).toEqual([0, 1000, 2000]);
    expect(split!.clusters.every((cluster) => cluster.start < cluster.end)).toBe(true);

    // Init must cover the EBML header, Segment header, Info and Tracks, and
    // stop before the first Cluster.
    const firstClusterStart = split!.clusters[0].start;
    expect(split!.initStart).toBe(0);
    expect(split!.initEnd).toBeLessThanOrEqual(firstClusterStart);
    // Every cluster lies strictly after init and is adjacent to its predecessor.
    for (let index = 0; index < split!.clusters.length; index += 1) {
      const cluster = split!.clusters[index];
      expect(cluster.start).toBeGreaterThanOrEqual(split!.initEnd);
      if (index > 0) expect(cluster.start).toBeGreaterThanOrEqual(split!.clusters[index - 1].end);
    }
  });

  it('preserves cluster byte ranges usable for slicing', () => {
    const webm = buildWebm([0, 1000], 2000);
    const split = splitWebm(webm)!;
    const initBytes = webm.slice(split.initStart, split.initEnd);
    expect(initBytes.length).toBe(split.initEnd);
    for (const cluster of split.clusters) {
      const slice = webm.slice(cluster.start, cluster.end);
      expect(slice.length).toBe(cluster.end - cluster.start);
      // A cluster slice must begin with the Cluster element ID (0x1F43B675),
      // not the cluster payload.
      expect(slice[0]).toBe(0x1f);
      expect(slice[1]).toBe(0x43);
      expect(slice[2]).toBe(0xb6);
      expect(slice[3]).toBe(0x75);
    }
  });

  it('returns null for non-WebM input', () => {
    expect(splitWebm(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });

  it('recovers without a cluster Timecode using ascending estimates', () => {
    // Cluster without Timecode element: the splitter falls back to a running estimate.
    const ebml = element(0x1a45dfa3, [0x77, 0x65, 0x62, 0x6d]);
    const info = element(0x1549a966, []);
    const tracks = element(0x1654ae6b, []);
    const cluster = element(0x1f43b675, [
      ...element(0xa3, [0x81, 0x00, 0x00, 0x00])
    ]);
    const segment = element(0x18538067, [...info, ...tracks, ...cluster, ...cluster]);
    const bytes = new Uint8Array([...ebml, ...segment]);
    const split = splitWebm(bytes)!;
    expect(split.clusters).toHaveLength(2);
    expect(split.clusters[0].timeMs).toBe(0);
    expect(split.clusters[1].timeMs).toBe(1);
  });
});
