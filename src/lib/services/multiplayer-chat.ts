import { writable, type Readable } from 'svelte/store';
import {
  MULTIPLAYER_CHAT_MAX_MESSAGE_LENGTH,
  MULTIPLAYER_CHAT_MAX_MESSAGES,
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

function createChatMessageId(): string {
  return crypto.randomUUID();
}

export function createMultiplayerChatMessage(
  name: string,
  text: string,
  sentAt = Date.now()
): MultiplayerChatMessage {
  return {
    id: createChatMessageId(),
    name: name.trim().slice(0, 48) || 'Guest',
    text: normalizeMultiplayerChatText(text),
    sentAt
  };
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
