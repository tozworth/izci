/**
 * Sequential range reader over a File's byte ranges. Parsers request bytes
 * through this so large metadata payloads are never fully materialized.
 */
export class FileRangeReader {
  readonly #file: File;
  readonly #ranges: Array<{ offset: number; length: number }>;
  readonly #readBytes: (offset: number, length: number) => Promise<Uint8Array>;
  #rangeIndex = 0;
  #rangeOffset = 0;
  #remaining: number;

  constructor(file: File, ranges: Array<{ offset: number; length: number }>, readBytes: (offset: number, length: number) => Promise<Uint8Array>) {
    this.#file = file;
    this.#ranges = ranges.filter((range) => range.length > 0);
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
      }
    }

    return true;
  }

  async read(length: number): Promise<Uint8Array | null> {
    if (length < 0 || length > this.#remaining) return null;

    const result = new Uint8Array(length);
    let resultOffset = 0;

    while (resultOffset < length) {
      const range = this.#ranges[this.#rangeIndex];
      const available = range.length - this.#rangeOffset;
      const requested = Math.min(length - resultOffset, available);
      const bytes = await this.#readBytes(range.offset + this.#rangeOffset, requested);

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
}
