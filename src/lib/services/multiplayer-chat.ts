import { writable, type Readable } from 'svelte/store';
import type { TrackItem } from '$lib/types';
import { getTrackDisplayTitle } from '$lib/utils/files';
import {
  MULTIPLAYER_CHAT_MAX_MESSAGE_LENGTH,
  MULTIPLAYER_CHAT_MAX_MESSAGES,
  isMultiplayerChatMessage,
  type MultiplayerChatAction,
  type MultiplayerCollection,
  type MultiplayerChatTrackLink,
  type MultiplayerChatMessage
} from './multiplayer-protocol';

const PERSISTED_HISTORY_STORAGE_KEY = 'izci.multiplayer-chat-history';
const store = writable<MultiplayerChatMessage[]>([]);
let currentMessages: MultiplayerChatMessage[] = [];
let persistedHistoryLimit = 0;

store.subscribe((messages) => {
  currentMessages = messages;
});

function publish(messages: MultiplayerChatMessage[]): void {
  currentMessages = messages;
  store.set(messages);
  persistHistory();
}

function persistHistory(): void {
  if (typeof window === 'undefined' || persistedHistoryLimit === 0) return;
  try {
    window.localStorage.setItem(
      PERSISTED_HISTORY_STORAGE_KEY,
      JSON.stringify(currentMessages.slice(-persistedHistoryLimit))
    );
  } catch {
    // Chat history is an optional local convenience; storage may be unavailable or full.
  }
}

function restorePersistedHistory(limit: number): void {
  persistedHistoryLimit = limit;
  if (typeof window === 'undefined') return;
  if (limit === 0) {
    try {
      window.localStorage.removeItem(PERSISTED_HISTORY_STORAGE_KEY);
    } catch {
      // Optional history cleanup may be unavailable.
    }
    return;
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(PERSISTED_HISTORY_STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(stored)) return;
    mergeHistory(stored.filter(isMultiplayerChatMessage).slice(-limit));
  } catch {
    // Ignore malformed or unavailable optional history.
  }
}

export function normalizeMultiplayerChatText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, MULTIPLAYER_CHAT_MAX_MESSAGE_LENGTH);
}

export function resolveMultiplayerChatTrackLink(
  track: TrackItem | null,
  collections: ReadonlyArray<{ collection: MultiplayerCollection; items: TrackItem[] }>
): MultiplayerChatTrackLink | null {
  if (!track) return null;
  const collection = collections.find(({ items }) => items.some((item) => item.id === track.id));
  return collection
    ? {
        collection: collection.collection,
        itemId: track.id,
        title: getTrackDisplayTitle(track) || track.name
      }
    : null;
}

export interface MultiplayerChatCommand {
  text: string;
  action?: MultiplayerChatAction | 'clear';
}

export function parseMultiplayerChatCommand(value: string): MultiplayerChatCommand | null {
  const normalized = normalizeMultiplayerChatText(value);
  if (!normalized) return null;
  if (/^\/np$/i.test(normalized)) return { text: '', action: 'now-playing' };
  if (/^\/clear$/i.test(normalized)) return { text: '', action: 'clear' };
  const command = normalized.match(/^\/me(?:\s+|$)/i);
  if (!command) return { text: normalized };
  const text = normalizeMultiplayerChatText(normalized.slice(command[0].length));
  return text ? { text, action: 'me' } : null;
}

export function parseMultiplayerChatSubmission(
  value: string,
  track?: MultiplayerChatTrackLink,
  action?: Extract<MultiplayerChatAction, 'now-playing'>
): MultiplayerChatCommand | null {
  if (action === 'now-playing') return { text: '', action };
  if (track) return { text: normalizeMultiplayerChatText(value) };
  return parseMultiplayerChatCommand(value);
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
  restorePersistedHistory(limit: number): void;
  stopPersisting(): void;
  clear(): void;
} = {
  subscribe: store.subscribe,
  getSnapshot: () => currentMessages,
  append,
  mergeHistory,
  restorePersistedHistory,
  stopPersisting: () => { persistedHistoryLimit = 0; },
  clear: () => publish([])
};
