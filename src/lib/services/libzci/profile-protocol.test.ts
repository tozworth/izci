import { describe, expect, it } from 'vitest';
import { validateDocumentMessage, validateResultPayload, validateSnapshotPayload } from './profile-protocol';

describe('profile worker protocol', () => {
  it('accepts known channels and rejects unknown ones', () => {
    expect(() =>
      validateDocumentMessage({ type: 'queue', command: { kind: 'clear_up_next' }, request: 'a/b' })
    ).not.toThrow();
    expect(() =>
      validateDocumentMessage({ type: 'catalog_query', query: { collection: 'library', search: '', sort: 'title', descending: false, offset: 0, limit: 100 }, request: 'a/b' })
    ).not.toThrow();
    expect(() => validateDocumentMessage({ type: 'bogus', request: 'a/b' })).toThrow('Unknown');
    expect(() => validateDocumentMessage({ type: 'queue', command: { kind: 'bogus' }, request: 'a/b' })).toThrow();
    expect(() => validateDocumentMessage({ type: 'begin_scan', root: 0, request: 'a/b' })).toThrow();
    expect(() => validateDocumentMessage({ type: 'cancel_scan', token: '', request: 'a/b' })).toThrow();
    expect(() =>
      validateDocumentMessage({ type: 'ingest', files: [new File(['a'], 'one.mp3')], handles: [], open: true, request: 'a/b' })
    ).not.toThrow();
    expect(() => validateDocumentMessage({ type: 'ingest', files: [], handles: [], open: true, request: 'a/b' })).toThrow();
    expect(() => validateDocumentMessage({ type: 'restore', request: '' })).toThrow();
    expect(() => validateDocumentMessage({ type: 'attach', rate: 48000, latency: 128 })).not.toThrow();
    expect(() => validateDocumentMessage({ type: 'attach', rate: 0, latency: 0 })).toThrow();
    expect(() => validateDocumentMessage({ type: 'context', state: 'running' })).not.toThrow();
    expect(() => validateDocumentMessage({ type: 'context', state: 'bogus' })).toThrow();
    expect(() => validateDocumentMessage({ type: 'ack' })).not.toThrow();
    expect(() => validateDocumentMessage({ type: 'output-error', detail: '' })).toThrow();
  });

  it('validates snapshot and result payloads', () => {
    expect(() => validateSnapshotPayload({ profile: { revision: 3, catalog_revision: 2 } })).not.toThrow();
    expect(() => validateSnapshotPayload({ profile: { revision: 'x' } })).toThrow();
    expect(() =>
      validateResultPayload('image_sequence', { revision: 1, media: [] })
    ).toThrow();
    expect(() =>
      validateResultPayload('image_sequence', { revision: 1, media: [5] })
    ).not.toThrow();
    const load = { occurrence: 1, source: { key: 'a', kind: 'ephemeral', locator: 'a', display_path: 'one.mp3' }, position_seconds: 0, subsong: null, autoplay: false };
    expect(() => validateResultPayload('restore', null)).not.toThrow();
    expect(() => validateResultPayload('restore', load)).not.toThrow();
    expect(() => validateResultPayload('restore', { ...load, occurrence: 0 })).toThrow();
    expect(() =>
      validateResultPayload('finish_scan', { root: 3, entries: 1, added: 1, removed: 0 })
    ).not.toThrow();
    expect(() => validateResultPayload('ingest', null)).toThrow();
    expect(() => validateResultPayload('queue', null)).toThrow();
  });
});
