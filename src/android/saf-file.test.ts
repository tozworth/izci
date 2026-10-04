import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSafFile } from './saf-file';
import { createMediaFileUrl } from '$lib/utils/native-media-files';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';

const document = { uri: 'content://provider/document/music%3Asong.wav', name: 'song.wav', size: 12, lastModified: 123, mime: 'audio/wav' };
let bytes: Uint8Array;
const fetchBytes = vi.fn(async (_url: string, init?: RequestInit) => {
  const range = (init?.headers as Record<string, string>).Range.match(/^bytes=(\d+)-(\d+)$/)!;
  return new Response(bytes.slice(Number(range[1]), Number(range[2]) + 1), { status: 206 });
});

beforeEach(() => {
  bytes = new TextEncoder().encode('abcdefghijkl');
  fetchBytes.mockClear();
  vi.stubGlobal('location', { origin: 'https://appassets.androidplatform.net' });
  vi.stubGlobal('fetch', fetchBytes);
});
afterEach(() => vi.unstubAllGlobals());

describe('SAF byte-backed files', () => {
  it('creates metadata and media URLs without reading or copying file contents', () => {
    const file = createSafFile(document);
    expect(file).toBeInstanceOf(File);
    expect([file.name, file.size, file.lastModified, file.type]).toEqual(['song.wav', 12, 123, 'audio/wav']);
    expect(createMediaFileUrl(file)).toContain('/__saf?uri=content%3A%2F%2F');
    expect(fetchBytes).not.toHaveBeenCalled();
  });
  it('reads exact ranges, nested slices, negative offsets and empty slices', async () => {
    const file = createSafFile(document);
    expect(await file.slice(2, 9).slice(1, 4).text()).toBe('def');
    expect(await file.slice(-3).text()).toBe('jkl');
    expect(await file.slice(8, 2).text()).toBe('');
    expect(fetchBytes).toHaveBeenCalledTimes(2);
    expect(new TextDecoder().decode(await file.arrayBuffer())).toBe('abcdefghijkl');
    expect(new TextDecoder().decode(await file.bytes())).toBe('abcdefghijkl');
  });
  it('streams in bounded chunks and reads a real WAV through the shared parser', async () => {
    const wav = new Uint8Array(44 + 8000);
    const view = new DataView(wav.buffer);
    for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) wav.set(new TextEncoder().encode(text), offset);
    view.setUint32(4, wav.length - 8, true); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true);
    view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true); view.setUint32(40, 8000, true);
    bytes = wav;
    const input = new Input({ source: new BlobSource(createSafFile({ ...document, size: wav.length })), formats: ALL_FORMATS });
    try { expect(await input.computeDuration()).toBeCloseTo(1); } finally { input.dispose(); }
    bytes = new Uint8Array(600_000);
    const reader = createSafFile({ ...document, size: bytes.length }).stream().getReader();
    expect((await reader.read()).value?.length).toBe(256 * 1024);
    await reader.cancel();
  });
  it('rejects denied and truncated provider reads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    await expect(createSafFile(document).arrayBuffer()).rejects.toThrow('403');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('short', { status: 206 })));
    await expect(createSafFile(document).arrayBuffer()).rejects.toThrow('incomplete');
  });
});
