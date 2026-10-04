import { registerNativeMediaUrl } from '$lib/utils/native-media-files';

export interface SafDocument {
  uri: string;
  name: string;
  size: number;
  lastModified: number;
  mime: string;
  path?: string;
}

export function safMediaUrl(uri: string): string {
  return `${location.origin}/__saf?uri=${encodeURIComponent(uri)}`;
}

function sliceOffset(value: number, size: number): number {
  const integer = Number.isNaN(value) ? 0 : Math.trunc(value);
  return integer < 0 ? Math.max(size + integer, 0) : Math.min(integer, size);
}

async function readRange(url: string, start: number, end: number): Promise<ArrayBuffer> {
  if (end <= start) return new ArrayBuffer(0);
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` }, cache: 'no-store' });
  if (response.status !== 206) throw new Error(`Android file read failed (${response.status}).`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== end - start) throw new Error('Android file changed or the provider returned an incomplete read.');
  return buffer;
}

function rangeStream(url: string, start: number, end: number): ReadableStream<Uint8Array<ArrayBuffer>> {
  let offset = start;
  let cancelled = false;
  return new ReadableStream({
    async pull(controller) {
      if (offset >= end) { controller.close(); return; }
      const next = Math.min(end, offset + 256 * 1024);
      try {
        const buffer = await readRange(url, offset, next);
        if (cancelled) return;
        offset = next;
        controller.enqueue(new Uint8Array(buffer));
      } catch (error) { if (!cancelled) controller.error(error); }
    },
    cancel() { cancelled = true; }
  });
}

/** A transient File view. Only requested slices cross into JS memory. */
class SafBlob extends Blob {
  constructor(private readonly url: string, private readonly start: number, private readonly end: number, type = '') {
    super([], { type });
  }
  override get size(): number { return Math.max(0, this.end - this.start); }
  override arrayBuffer(): Promise<ArrayBuffer> { return readRange(this.url, this.start, this.end); }
  override async text(): Promise<string> { return new TextDecoder().decode(await this.arrayBuffer()); }
  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> { return rangeStream(this.url, this.start, this.end); }
  override async bytes(): Promise<Uint8Array<ArrayBuffer>> { return new Uint8Array(await this.arrayBuffer()); }
  override slice(start = 0, end = this.size, contentType = ''): Blob {
    const first = sliceOffset(start, this.size);
    const last = Math.max(first, sliceOffset(end, this.size));
    return new SafBlob(this.url, this.start + first, this.start + last, contentType);
  }
}

class SafFile extends File {
  private readonly source: SafBlob;
  constructor(document: SafDocument, url: string) {
    super([], document.name, { type: document.mime, lastModified: document.lastModified });
    this.source = new SafBlob(url, 0, document.size, document.mime);
  }
  override get size(): number { return this.source.size; }
  override arrayBuffer(): Promise<ArrayBuffer> { return this.source.arrayBuffer(); }
  override text(): Promise<string> { return this.source.text(); }
  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> { return this.source.stream(); }
  override bytes(): Promise<Uint8Array<ArrayBuffer>> { return this.source.bytes(); }
  override slice(start?: number, end?: number, contentType?: string): Blob { return this.source.slice(start, end, contentType); }
}

export function createSafFile(document: SafDocument): File {
  if (!Number.isSafeInteger(document.size) || document.size < 0) throw new Error('The file provider did not report a usable file size.');
  const url = safMediaUrl(document.uri);
  const file = new SafFile(document, url);
  registerNativeMediaUrl(file, url);
  return file;
}
