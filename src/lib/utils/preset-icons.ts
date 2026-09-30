import type { MaterialSymbol } from '@material-symbols/font-400';

// Row-major order for the shared eight-column, five-row picker.
export const PRESET_ICONS = [
  'music_note', 'music_video', 'album', 'library_music', 'queue_music', 'playlist_play', 'piano', 'lyrics',
  'headphones', 'speaker', 'speaker_group', 'radio', 'mic', 'equalizer', 'graphic_eq', 'tune',
  'volume_up', 'spatial_audio', 'hearing', 'surround_sound', 'waves', 'speed', 'slow_motion_video', 'animation',
  'video_library', 'movie', 'theaters', 'tv', 'live_tv', 'videocam', 'image', 'photo_library',
  'favorite', 'star', 'bookmark', 'bolt', 'flare', 'nightlight', 'wb_sunny', 'local_fire_department'
] as const satisfies readonly MaterialSymbol[];

export type PresetIcon = typeof PRESET_ICONS[number];

export function normalizePresetIcon(value: unknown): PresetIcon | undefined {
  return typeof value === 'string' && PRESET_ICONS.includes(value as PresetIcon)
    ? value as PresetIcon
    : undefined;
}
