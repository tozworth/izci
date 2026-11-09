import { describe, expect, it } from 'vitest';
import { buildRenditionRequest, defaultRenditionRequest, serializeRenditionRequest } from './rendition-request';

describe('core rendition request', () => {
  it('defaults to a 512-edge artwork request', () => {
    expect(defaultRenditionRequest()).toEqual({ kind: 'artwork', spec: { max_edge: 512 } });
    expect(defaultRenditionRequest('image')).toEqual({ kind: 'image', spec: { max_edge: 512 } });
  });

  it('validates kind and edge bounds', () => {
    expect(buildRenditionRequest('artwork', 2048)).toEqual({ kind: 'artwork', spec: { max_edge: 2048 } });
    expect(JSON.parse(serializeRenditionRequest({ kind: 'image', spec: { max_edge: 256 } }))).toEqual(
      buildRenditionRequest('image', 256)
    );
    expect(() => buildRenditionRequest('bogus' as never, 512)).toThrow();
    expect(() => buildRenditionRequest('image', 0)).toThrow();
    expect(() => buildRenditionRequest('image', 2049)).toThrow();
  });
});
