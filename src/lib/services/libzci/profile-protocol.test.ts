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
  });
});
