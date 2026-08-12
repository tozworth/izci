import {
  MODULE_EXTENSIONS,
  STREAM_EXTENSIONS,
  SUPPORTED_MEDIA_EXTENSIONS,
  VIDEO_EXTENSIONS,
  type TrackKind
} from '../contracts/media-format';

export type MediaPickerGrouping = 'detailed' | 'wildcard';

const DOTTED_STREAM_EXTENSIONS = STREAM_EXTENSIONS.map((extension) => `.${extension}`);
const DOTTED_MODULE_EXTENSIONS = MODULE_EXTENSIONS.map((extension) => `.${extension}`);
const DOTTED_VIDEO_EXTENSIONS = VIDEO_EXTENSIONS.map((extension) => `.${extension}`);

export function inferMediaExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1)! : '';
}

export function inferTrackKind(extension: string): TrackKind | null {
  const normalized = extension.toLowerCase();
  if ((STREAM_EXTENSIONS as readonly string[]).includes(normalized)) return 'stream';
  if ((MODULE_EXTENSIONS as readonly string[]).includes(normalized)) return 'module';
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(normalized)) return 'video';
  return null;
}

export function mediaExtensions(kinds: readonly TrackKind[]): string[] {
  const selected = new Set(kinds);
  return [
    ...(selected.has('stream') ? DOTTED_STREAM_EXTENSIONS : []),
    ...(selected.has('module') ? DOTTED_MODULE_EXTENSIONS : []),
    ...(selected.has('video') ? DOTTED_VIDEO_EXTENSIONS : [])
  ];
}

export function mediaFileInputAccept(
  kinds: readonly TrackKind[] = ['stream', 'module', 'video']
): string {
  return mediaExtensions(kinds).join(',');
}

export function mediaPickerAccept(
  kinds: readonly TrackKind[] = ['stream', 'module', 'video'],
  grouping: MediaPickerGrouping = 'detailed'
): Record<string, string[]> {
  const selected = new Set(kinds);
  if (grouping === 'wildcard') {
    const accept: Record<string, string[]> = {};
    const audio = mediaExtensions([...selected].filter((kind) => kind !== 'video'));
    if (audio.length > 0) accept['audio/*'] = audio;
    if (selected.has('video')) accept['video/*'] = [...DOTTED_VIDEO_EXTENSIONS];
    return accept;
  }

  return {
    ...(selected.has('stream') ? {
      'audio/mpeg': ['.mp3'],
      'audio/wav': ['.wav'],
      'audio/flac': ['.flac'],
      'audio/ogg': ['.ogg', '.opus'],
      'audio/opus': ['.opus']
    } : {}),
    ...(selected.has('module') ? { 'audio/x-openmpt': [...DOTTED_MODULE_EXTENSIONS] } : {}),
    ...(selected.has('video') ? {
      'video/mp4': ['.mp4', '.m4v'],
      'video/quicktime': ['.mov'],
      'video/webm': ['.webm'],
      'video/x-matroska': ['.mkv']
    } : {})
  };
}

export function createMediaOpenFilePickerOptions(options: {
  readonly description: string;
  readonly multiple: boolean;
  readonly kinds?: readonly TrackKind[];
  readonly grouping?: MediaPickerGrouping;
}): OpenFilePickerOptions {
  return {
    multiple: options.multiple,
    types: [{
      description: options.description,
      accept: mediaPickerAccept(options.kinds, options.grouping)
    }]
  };
}

/** Conservative installed-PWA associations, intentionally narrower than internal support. */
export const PWA_MEDIA_FILE_HANDLER_ACCEPT: Readonly<Record<string, readonly string[]>> = {
  'audio/mpeg': ['.mp3'],
  'audio/wav': ['.wav'],
  'audio/flac': ['.flac'],
  'audio/ogg': ['.ogg', '.opus'],
  'audio/opus': ['.opus'],
  'audio/x-mod': ['.mod'],
  'audio/x-xm': ['.xm'],
  'audio/x-s3m': ['.s3m'],
  'audio/x-it': ['.it'],
  'audio/x-mo3': ['.mo3'],
  'audio/x-hivelytracker': ['.ahx', '.hvl'],
  'video/mp4': ['.mp4', '.m4v'],
  'video/quicktime': ['.mov'],
  'video/webm': ['.webm'],
  'video/x-matroska': ['.mkv']
};

export function isSupportedMediaExtension(extension: string): boolean {
  return (SUPPORTED_MEDIA_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}
