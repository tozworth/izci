import { describe, expect, it } from 'vitest';
import { readHivelyCStringForTest } from './hively-pattern-inspect';

function memoryWithString(text: string): { memory: WebAssembly.Memory; pointer: number } {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const bytes = new Uint8Array(memory.buffer);
  const pointer = 64;
  const encoded = new TextEncoder().encode(text);
  bytes.set(encoded, pointer);
  bytes[pointer + encoded.length] = 0;
  return { memory, pointer };
}

describe('Hively output-free inspection helpers', () => {
  it('reads NUL-terminated instrument/title strings without audio output', () => {
    const { memory, pointer } = memoryWithString('Lead');
    expect(readHivelyCStringForTest(memory, pointer)).toBe('Lead');
  });

  it('returns empty text for null or out-of-range pointers', () => {
    const { memory } = memoryWithString('Lead');
    expect(readHivelyCStringForTest(memory, 0)).toBe('');
    expect(readHivelyCStringForTest(memory, 1_000_000)).toBe('');
  });
});
