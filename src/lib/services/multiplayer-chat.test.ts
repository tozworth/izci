import { afterEach, describe, expect, it } from 'vitest';
import {
  createMultiplayerChatMessage,
  createMultiplayerChatNotice,
  multiplayerChat,
  normalizeMultiplayerChatText,
  parseMultiplayerChatCommand
} from './multiplayer-chat';

afterEach(() => multiplayerChat.clear());

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

  it('creates typed join and leave notices', () => {
    expect(createMultiplayerChatNotice('client123', 'join', 123))
      .toMatchObject({ name: 'client123', text: 'joined', action: 'join', sentAt: 123 });
    expect(createMultiplayerChatNotice('client123', 'leave', 456))
      .toMatchObject({ name: 'client123', text: 'left', action: 'leave', sentAt: 456 });
  });
});
