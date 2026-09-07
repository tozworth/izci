import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMultiplayerChatMessage,
  createMultiplayerChatNotice,
  multiplayerChat,
  normalizeMultiplayerChatText,
  parseMultiplayerChatCommand,
  parseMultiplayerChatSubmission,
  resolveMultiplayerChatTrackLink
} from './multiplayer-chat';

afterEach(() => {
  multiplayerChat.restorePersistedHistory(0);
  multiplayerChat.clear();
  vi.unstubAllGlobals();
});

describe('multiplayer chat', () => {
  it('normalizes messages for the single-line IRC-style view', () => {
    expect(normalizeMultiplayerChatText('  hello\nworld\u0000  ')).toBe('hello world');
    expect(createMultiplayerChatMessage('  Host  ', 'hello', 123)).toMatchObject({
      name: 'Host',
      text: 'hello',
      sentAt: 123
    });
    expect(createMultiplayerChatMessage('Host', 'Song', 123, {
      collection: 'library',
      itemId: 'track',
      title: 'Song'
    })).toMatchObject({
      text: 'Song',
      track: { collection: 'library', itemId: 'track', title: 'Song' }
    });
    expect(resolveMultiplayerChatTrackLink({
      id: 'track',
      name: 'fallback-name.flac',
      extension: 'flac',
      kind: 'stream',
      size: 1,
      lastModified: 1,
      metadata: { title: 'Song' }
    }, [
      { collection: 'queue', items: [] },
      { collection: 'library', items: [{
        id: 'track',
        name: 'fallback-name.flac',
        extension: 'flac',
        kind: 'stream',
        size: 1,
        lastModified: 1,
        metadata: { title: 'Song' }
      }] }
    ])).toEqual({ collection: 'library', itemId: 'track', title: 'Song' });
  });

  it('deduplicates live messages and merges room history', () => {
    const first = { id: 'first', name: 'A', text: 'one', sentAt: 2 };
    const second = { id: 'second', name: 'B', text: 'two', sentAt: 1 };

    multiplayerChat.append(first);
    multiplayerChat.append(first);
    multiplayerChat.mergeHistory([second, first]);

    expect(multiplayerChat.getSnapshot()).toEqual([second, first]);
  });

  it('parses /me into a bounded action payload', () => {
    expect(parseMultiplayerChatCommand('  /me   waves\n')).toEqual({
      text: 'waves',
      action: 'me'
    });
    expect(parseMultiplayerChatCommand('/message stays plain')).toEqual({
      text: '/message stays plain'
    });
    expect(parseMultiplayerChatCommand('/me')).toBeNull();
    expect(createMultiplayerChatMessage('Host', 'waves', 123, undefined, 'me'))
      .toMatchObject({ action: 'me', text: 'waves' });
  });

  it('parses /np as a now-playing command without a message body', () => {
    expect(parseMultiplayerChatCommand('  /NP  ')).toEqual({
      text: '',
      action: 'now-playing'
    });
    expect(parseMultiplayerChatCommand('/np After Dark')).toEqual({
      text: '/np After Dark'
    });
    expect(createMultiplayerChatMessage('client123', 'After Dark', 123, {
      collection: 'queue',
      itemId: 'track',
      title: 'After Dark'
    }, 'now-playing')).toMatchObject({
      action: 'now-playing',
      text: 'After Dark',
      track: { title: 'After Dark' }
    });
  });

  it('parses /clear as a host-only command without a message body', () => {
    expect(parseMultiplayerChatCommand('  /CLEAR  ')).toEqual({
      text: '',
      action: 'clear'
    });
  });

  it('does not interpret linked track titles as slash commands', () => {
    const track = { collection: 'library' as const, itemId: 'track', title: '/clear' };

    expect(parseMultiplayerChatSubmission('/clear', track)).toEqual({ text: '/clear' });
    expect(parseMultiplayerChatSubmission('/np', { ...track, title: '/np' })).toEqual({ text: '/np' });
    expect(parseMultiplayerChatSubmission('/np', track, 'now-playing')).toEqual({
      text: '',
      action: 'now-playing'
    });
  });

  it('updates preserved history when chat is cleared', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      }
    });

    multiplayerChat.restorePersistedHistory(10);
    multiplayerChat.append({ id: 'one', name: 'A', text: 'hello', sentAt: 1 });
    multiplayerChat.clear();

    expect(values.get('izci.multiplayer-chat-history')).toBe('[]');
  });

  it('creates typed join and leave notices', () => {
    expect(createMultiplayerChatNotice('client123', 'join', 123))
      .toMatchObject({ name: 'client123', text: 'joined', action: 'join', sentAt: 123 });
    expect(createMultiplayerChatNotice('client123', 'leave', 456))
      .toMatchObject({ name: 'client123', text: 'left', action: 'leave', sentAt: 456 });
  });
});
