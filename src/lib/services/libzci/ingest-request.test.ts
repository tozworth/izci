import { describe, expect, it } from 'vitest';
import { buildIngestRequest, validateIngestRequest } from './ingest-request';

describe('core ingest request boundary', () => {
  it('builds validated ingest requests', () => {
    const files = [new File(['audio'], 'one.mp3'), new File(['audio'], 'two.ogg')];
    const built = buildIngestRequest(files, [], true, 'req-1/ingest');
    expect(built.files).toHaveLength(2);
    expect(built.handles).toEqual([]);
    expect(built.open).toBe(true);
    expect(() => validateIngestRequest(built)).not.toThrow();
  });

  it('requires parallel handles when present', () => {
    const files = [new File(['a'], 'one.mp3'), new File(['b'], 'two.mp3')];
    expect(() => buildIngestRequest(files, [{}], true, 'req-2/ingest')).toThrow('one per file');
    expect(() =>
      buildIngestRequest(files, [{}, {}], true, 'req-2/ingest')
    ).not.toThrow();
  });

  it('rejects empty batches and oversized files', () => {
    expect(() => buildIngestRequest([], [], true, 'req-3/ingest')).toThrow('1..10000');
    const big = new File([new Uint8Array(64 * 1024 * 1024 + 1)], 'big.mod');
    expect(() => buildIngestRequest([big], [], true, 'req-4/ingest')).toThrow('64 MiB');
  });
});
