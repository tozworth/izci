import { afterEach, describe, expect, it } from 'vitest';
import {
  createMultiplayerChatMessage,
  multiplayerChat,
  normalizeMultiplayerChatText
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
  });

  it('deduplicates live messages and merges room history', () => {
    const first = { id: 'first', name: 'A', text: 'one', sentAt: 2 };
    const second = { id: 'second', name: 'B', text: 'two', sentAt: 1 };

    multiplayerChat.append(first);
    multiplayerChat.append(first);
    multiplayerChat.mergeHistory([second, first]);

    expect(multiplayerChat.getSnapshot()).toEqual([second, first]);
  });
});
