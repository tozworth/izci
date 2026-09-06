import { writable, type Readable } from 'svelte/store';
import {
  MULTIPLAYER_CHAT_MAX_MESSAGE_LENGTH,
  MULTIPLAYER_CHAT_MAX_MESSAGES,
  type MultiplayerChatAction,
  type MultiplayerChatTrackLink,
  type MultiplayerChatMessage
} from './multiplayer-protocol';

const store = writable<MultiplayerChatMessage[]>([]);
let currentMessages: MultiplayerChatMessage[] = [];

store.subscribe((messages) => {
  currentMessages = messages;
});

function publish(messages: MultiplayerChatMessage[]): void {
  currentMessages = messages;
  store.set(messages);
}

export function normalizeMultiplayerChatText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, MULTIPLAYER_CHAT_MAX_MESSAGE_LENGTH);
}

export interface MultiplayerChatCommand {
  text: string;
  action?: MultiplayerChatAction;
}

export function parseMultiplayerChatCommand(value: string): MultiplayerChatCommand | null {
  const normalized = normalizeMultiplayerChatText(value);
  if (!normalized) return null;
  const command = normalized.match(/^\/me(?:\s+|$)/i);
  if (!command) return { text: normalized };
  const text = normalizeMultiplayerChatText(normalized.slice(command[0].length));
  return text ? { text, action: 'me' } : null;
}

function normalizeMultiplayerChatName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 48) || 'Guest';
}

function createChatMessageId(): string {
  return crypto.randomUUID();
}

export function createMultiplayerChatMessage(
  name: string,
  text: string,
  sentAt = Date.now(),
  track?: MultiplayerChatTrackLink,
  action?: MultiplayerChatAction
): MultiplayerChatMessage {
  const normalizedTrackTitle = track ? normalizeMultiplayerChatText(track.title) : '';
  return {
    id: createChatMessageId(),
    name: normalizeMultiplayerChatName(name),
    text: normalizeMultiplayerChatText(text),
    sentAt,
    ...(action ? { action } : {}),
    ...(track && normalizedTrackTitle
      ? {
          track: {
            collection: track.collection,
            itemId: track.itemId.slice(0, 200),
            title: normalizedTrackTitle
          }
        }
      : {})
  };
}

export function createMultiplayerChatNotice(
  name: string,
  action: 'join' | 'leave',
  sentAt = Date.now()
): MultiplayerChatMessage {
  return createMultiplayerChatMessage(
    name,
    action === 'join' ? 'joined' : 'left',
    sentAt,
    undefined,
    action
  );
}

function append(message: MultiplayerChatMessage): void {
  if (currentMessages.some((existing) => existing.id === message.id)) return;
  publish([...currentMessages, message].slice(-MULTIPLAYER_CHAT_MAX_MESSAGES));
}

function mergeHistory(messages: MultiplayerChatMessage[]): void {
  const byId = new Map(currentMessages.map((message) => [message.id, message]));
  for (const message of messages) byId.set(message.id, message);
  publish([...byId.values()]
    .sort((first, second) => first.sentAt - second.sentAt)
    .slice(-MULTIPLAYER_CHAT_MAX_MESSAGES));
}

export const multiplayerChat: Readable<MultiplayerChatMessage[]> & {
  getSnapshot(): MultiplayerChatMessage[];
  append(message: MultiplayerChatMessage): void;
  mergeHistory(messages: MultiplayerChatMessage[]): void;
  clear(): void;
} = {
  subscribe: store.subscribe,
  getSnapshot: () => currentMessages,
  append,
  mergeHistory,
  clear: () => publish([])
};
