/**
 * Sequential range reader over a File's byte ranges. Parsers request bytes
 * through this so large metadata payloads are never fully materialized.
 *
 * Reads are served from an internal window buffer: tiny field reads (lengths,
 * probes) coalesce into one large slice per window, which matters on mobile
 * where each blob slice round-trip can cost hundreds of milliseconds.
 */
const READ_WINDOW_BYTES = 4 * 1024;

/** Collapse back-to-back ranges into one; Ogg page segments are contiguous. */
function mergeContiguousRanges(ranges: Array<{ offset: number; length: number }>): Array<{ offset: number; length: number }> {
  const merged: Array<{ offset: number; length: number }> = [];

  for (const range of ranges) {
    const last = merged[merged.length - 1];

    if (last && range.offset === last.offset + last.length) {
      last.length += range.length;
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
}

export class FileRangeReader {
  readonly #file: File;
  readonly #ranges: Array<{ offset: number; length: number }>;
  readonly #readBytes: (offset: number, length: number) => Promise<Uint8Array>;
  #rangeIndex = 0;
  #rangeOffset = 0;
  #remaining: number;
  /** Buffered bytes for the current window; lazily filled. */
  #window: Uint8Array | null = null;
  /** File offset corresponding to #window[0]. */
  #windowOffset = 0;

  constructor(file: File, ranges: Array<{ offset: number; length: number }>, readBytes: (offset: number, length: number) => Promise<Uint8Array>) {
    this.#file = file;
    this.#ranges = mergeContiguousRanges(ranges.filter((range) => range.length > 0));
    this.#remaining = this.#ranges.reduce((total, range) => total + range.length, 0);
    this.#readBytes = readBytes;
  }

  get remaining(): number {
    return this.#remaining;
  }

  skip(length: number): boolean {
    if (length < 0 || length > this.#remaining) return false;

    let remaining = length;
    while (remaining > 0) {
      const range = this.#ranges[this.#rangeIndex];
      const available = range.length - this.#rangeOffset;
      const consumed = Math.min(remaining, available);
      this.#rangeOffset += consumed;
      this.#remaining -= consumed;
      remaining -= consumed;

      if (this.#rangeOffset === range.length) {
        this.#rangeIndex += 1;
        this.#rangeOffset = 0;
        this.#window = null;
      }
    }

    return true;
  }

  async read(length: number): Promise<Uint8Array | null> {
    if (length < 0 || length > this.#remaining) return null;

    // Fast path: the whole request is inside the current buffered window.
    const buffered = await this.#ensureWindow(length);
    if (buffered) {
      const result = buffered.subarray(0, length);
      this.skip(length);
      return result.slice();
    }

    const result = new Uint8Array(length);
    let resultOffset = 0;

    while (resultOffset < length) {
      const range = this.#ranges[this.#rangeIndex];
      const available = range.length - this.#rangeOffset;
      const requested = Math.min(length - resultOffset, available);
      const bytes = await this.#readViaWindow(range.offset + this.#rangeOffset, requested);

      if (bytes.byteLength !== requested) return null;
      result.set(bytes, resultOffset);
      resultOffset += requested;
      this.skip(requested);
    }

    return result;
  }

  async readUint32LE(): Promise<number | null> {
    const bytes = await this.read(4);
    return bytes ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) : null;
  }

  /**
   * Fill the window with at least `length` bytes of the current position when
   * they sit inside a single range. Returns the windowed view or null when the
   * request crosses ranges or exceeds the window size.
   */
  async #ensureWindow(length: number): Promise<Uint8Array | null> {
    if (length === 0 || length > READ_WINDOW_BYTES) return null;

    const range = this.#ranges[this.#rangeIndex];
    if (!range) return null;
    const absolute = range.offset + this.#rangeOffset;
    const rangeRemaining = range.length - this.#rangeOffset;
    const buffered = this.#window;
    const usable = buffered !== null && absolute >= this.#windowOffset && absolute < this.#windowOffset + buffered.byteLength
      ? Math.min(this.#windowOffset + buffered.byteLength - absolute, rangeRemaining)
      : 0;

    if (usable >= length && buffered !== null) {
      return buffered.subarray(absolute - this.#windowOffset, absolute - this.#windowOffset + usable);
    }

    const fillLength = Math.min(Math.max(length, READ_WINDOW_BYTES), rangeRemaining);
    const filled = await this.#readBytes(absolute, fillLength);
    if (filled.byteLength < length) return null;

    this.#window = filled;
    this.#windowOffset = absolute;
    return filled.subarray(0, filled.byteLength);
  }

  async #readViaWindow(offset: number, length: number): Promise<Uint8Array> {
    const buffered = await this.#ensureWindow(length);
    if (buffered) {
      const start = offset - this.#windowOffset;
      return buffered.subarray(start, start + length).slice();
    }
    return this.#readBytes(offset, length);
  }
}
