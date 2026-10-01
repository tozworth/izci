import type { ClipExportOptions } from './clip-export-options';
import type { EditableTags } from './tag-writer';

export type EditorExportRequest = {
  type: 'start';
  options: ClipExportOptions;
  tags: EditableTags;
  artwork: Blob | null;
  sampleRate: number;
  numberOfChannels: number;
} | {
  type: 'chunk';
  data: ArrayBuffer;
  timestamp: number;
} | { type: 'finish' };

export type EditorExportResponse = { type: 'ready' }
  | { type: 'complete'; buffer: ArrayBuffer; mimeType: string }
  | { type: 'error'; message: string; unavailable?: boolean };
