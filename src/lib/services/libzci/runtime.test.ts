import { describe, expect, it } from 'vitest';
import { EngineRequestTable, LIBZCI_AUDIO_WASM_URL, LIBZCI_WORKLET_URL } from './runtime';

describe('libzci shared engine runtime', () => {
  it('keeps one import site for the generated browser assets', () => {
    expect(LIBZCI_WORKLET_URL).toContain('playback.worklet');
    expect(LIBZCI_AUDIO_WASM_URL).toContain('libzci_audio_web.wasm');
  });

  it('multiplexes worker results across pending requests', async () => {
    const table = new EngineRequestTable();
    const first = new Promise((resolve, reject) => table.add('a', { resolve, reject }));
    const second = new Promise((resolve, reject) => table.add('b', { resolve, reject }));
    expect(table.size).toBe(2);

    expect(table.resolve('a', 42)).toBe(true);
    await expect(first).resolves.toBe(42);
    expect(table.size).toBe(1);

    // Unknown request ids are ignored so late worker results stay harmless.
    expect(table.resolve('stale', null)).toBe(false);
    expect(table.reject('stale', new Error('late'))).toBe(false);

    expect(table.reject('b', new Error('decoder failed'))).toBe(true);
    await expect(second).rejects.toThrow('decoder failed');
    expect(table.size).toBe(0);
  });

  it('rejects every outstanding request when the link closes', async () => {
    const table = new EngineRequestTable();
    const first = new Promise((resolve, reject) => table.add('a', { resolve, reject }));
    const second = new Promise((resolve, reject) => table.add('b', { resolve, reject }));
    table.rejectAll(new Error('libzci stream closed'));
    await expect(first).rejects.toThrow('libzci stream closed');
    await expect(second).rejects.toThrow('libzci stream closed');
    expect(table.size).toBe(0);
  });
});
