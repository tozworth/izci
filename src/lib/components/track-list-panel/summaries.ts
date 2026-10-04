import { formatTotalDuration, getTotalDuration } from './search';
import type { LibraryGroupViewId, RepeatMode, TrackItem } from '$lib/types';
import type { LibraryGroup } from './library-views';
import type { TranslationOptions } from '$lib/i18n';

// Localized panel summaries that stay reactive to locale changes.

type Translate = (id: string, options?: TranslationOptions) => string;

export function getRepeatControlLabel(repeatMode: RepeatMode, translate: Translate): string {
  return repeatMode === 'one'
    ? translate('queue.repeat.currentTrack', { default: 'Repeat current track' })
    : repeatMode === 'all'
      ? translate('queue.repeat.queue', { default: 'Repeat queue' })
      : translate('queue.repeat.off', { default: 'Repeat off' });
}

export function localizePanelLabel(label: string, translate: Translate): string {
  if (label === 'Queue') return translate('queue.title', { default: 'Queue' });
  if (label === 'Library') return translate('library.title', { default: 'Library' });
  return label;
}

export function localizeLibraryGroup(group: LibraryGroup, translate: Translate): LibraryGroup {
  let label = group.label;
  let secondary = group.secondary;

  switch (group.placeholder) {
    case 'artist': label = translate('library.unknownArtist', { default: 'Unknown artist' }); break;
    case 'album': label = translate('library.unknownAlbum', { default: 'Unknown album' }); break;
    case 'genre': label = translate('library.unknownGenre', { default: 'Unknown genre' }); break;
    case 'year': label = translate('library.unknownYear', { default: 'Unknown year' }); break;
    case 'format': label = translate('library.unknownFormat', { default: 'Unknown format' }); break;
    case 'folder': label = translate('library.unknownFolder', { default: 'Unknown folder' }); break;
  }

  if (group.secondaryKind === 'trackerModule') {
    secondary = translate('library.trackerModule', { default: 'Module' });
  } else if (group.secondaryKind === 'stream') {
    secondary = translate('library.stream', { default: 'Audio' });
  } else if (group.secondaryKind === 'video') {
    secondary = translate('library.video', { default: 'Video' });
  } else if (group.secondaryKind === 'image') {
    secondary = translate('library.image', { default: 'Image' });
  }

  return { ...group, label, secondary };
}

export type QueueSummaryKind = 'songs' | 'images' | 'videos' | 'items';

export function getQueueSummaryKind(items: TrackItem[]): QueueSummaryKind {
  if (items.length === 0) return 'items';
  if (items.every((item) => item.kind === 'image')) return 'images';
  if (items.every((item) => item.kind === 'video')) return 'videos';
  if (items.every((item) => item.kind !== 'image' && item.kind !== 'video')) return 'songs';
  return 'items';
}

export function getLocalizedItemCount(items: TrackItem[], translate: Translate): string {
  const kind = getQueueSummaryKind(items);
  const labels = {
    songs: '{count, plural, one {# song} other {# songs}}',
    images: '{count, plural, one {# image} other {# images}}',
    videos: '{count, plural, one {# video} other {# videos}}',
    items: '{count, plural, one {# item} other {# items}}'
  };
  return translate(`library.summary.count${kind[0].toUpperCase()}${kind.slice(1)}`, {
    default: labels[kind],
    values: { count: items.length }
  });
}

function getQueueTracksSummary(
  kind: QueueSummaryKind,
  count: number,
  duration: string,
  translate: Translate
): string {
  switch (kind) {
    case 'images':
      return translate('queue.summary.tracksImages', {
        default: '{count, plural, one {# image} other {# images}} · {duration}',
        values: { count, duration }
      });
    case 'videos':
      return translate('queue.summary.tracksVideos', {
        default: '{count, plural, one {# video} other {# videos}} · {duration}',
        values: { count, duration }
      });
    case 'items':
      return translate('queue.summary.tracksItems', {
        default: '{count, plural, one {# item} other {# items}} · {duration}',
        values: { count, duration }
      });
    case 'songs':
    default:
      return translate('queue.summary.tracks', {
        default: '{count, plural, one {# song} other {# songs}} · {duration}',
        values: { count, duration }
      });
  }
}

function getFilteredQueueTracksSummary(
  kind: QueueSummaryKind,
  visible: number,
  total: number,
  duration: string,
  translate: Translate
): string {
  const values = { visible, total, duration };
  switch (kind) {
    case 'images':
      return translate('queue.summary.filteredTracksImages', {
        default: '{visible} of {total} {total, plural, one {image} other {images}} · {duration}',
        values
      });
    case 'videos':
      return translate('queue.summary.filteredTracksVideos', {
        default: '{visible} of {total} {total, plural, one {video} other {videos}} · {duration}',
        values
      });
    case 'items':
      return translate('queue.summary.filteredTracksItems', {
        default: '{visible} of {total} {total, plural, one {item} other {items}} · {duration}',
        values
      });
    case 'songs':
    default:
      return translate('queue.summary.filteredTracks', {
        default: '{visible} of {total} {total, plural, one {song} other {songs}} · {duration}',
        values
      });
  }
}

export function getLocalizedTrackSummary(
  sourceItems: TrackItem[],
  visibleItems: TrackItem[],
  query: string,
  translate: Translate
): string {
  const duration = formatTotalDuration(getTotalDuration(visibleItems));


  if (query && visibleItems.length !== sourceItems.length) {
    return getFilteredQueueTracksSummary(
      getQueueSummaryKind(sourceItems),
      visibleItems.length,
      sourceItems.length,
      duration,
      translate
    );
  }

  return getQueueTracksSummary(getQueueSummaryKind(visibleItems), visibleItems.length, duration, translate);
}

function getGroupCountSummary(
  view: LibraryGroupViewId,
  visible: number,
  total: number,
  filtered: boolean,
  translate: Translate
): string {
  const values = { visible, total, count: visible };

  if (filtered) {
    switch (view) {
      case 'artists': return translate('library.summary.filteredArtists', { default: '{visible} of {total} {total, plural, one {artist} other {artists}}', values });
      case 'albums': return translate('library.summary.filteredAlbums', { default: '{visible} of {total} {total, plural, one {album} other {albums}}', values });
      case 'genres': return translate('library.summary.filteredGenres', { default: '{visible} of {total} {total, plural, one {genre} other {genres}}', values });
      case 'years': return translate('library.summary.filteredYears', { default: '{visible} of {total} {total, plural, one {year} other {years}}', values });
      case 'formats': return translate('library.summary.filteredFormats', { default: '{visible} of {total} {total, plural, one {format} other {formats}}', values });
      case 'folders': return translate('library.summary.filteredFolders', { default: '{visible} of {total} {total, plural, one {folder} other {folders}}', values });
    }
  }

  switch (view) {
    case 'artists': return translate('library.summary.artists', { default: '{count, plural, one {# artist} other {# artists}}', values });
    case 'albums': return translate('library.summary.albums', { default: '{count, plural, one {# album} other {# albums}}', values });
    case 'genres': return translate('library.summary.genres', { default: '{count, plural, one {# genre} other {# genres}}', values });
    case 'years': return translate('library.summary.years', { default: '{count, plural, one {# year} other {# years}}', values });
    case 'formats': return translate('library.summary.formats', { default: '{count, plural, one {# format} other {# formats}}', values });
    case 'folders': return translate('library.summary.folders', { default: '{count, plural, one {# folder} other {# folders}}', values });
  }
}

export function getLibraryGroupSummary(
  view: LibraryGroupViewId,
  visibleGroups: number,
  totalGroups: number,
  items: TrackItem[],
  query: string,
  translate: Translate
): string {
  const groups = getGroupCountSummary(view, visibleGroups, totalGroups, Boolean(query) && visibleGroups !== totalGroups, translate);
  return translate('library.summary.groupsAndItems', {
    default: '{groups} · {items}',
    values: { groups, items: getLocalizedItemCount(items, translate) }
  });
}

export function getLibraryGroupTrackSummary(
  group: LibraryGroup,
  visibleItems: TrackItem[],
  translate: Translate
): string {
  const duration = formatTotalDuration(getTotalDuration(visibleItems));

  if (visibleItems.length !== group.items.length) {
    return getFilteredQueueTracksSummary(
      getQueueSummaryKind(group.items),
      visibleItems.length,
      group.items.length,
      duration,
      translate
    );
  }

  return getQueueTracksSummary(getQueueSummaryKind(visibleItems), visibleItems.length, duration, translate);
}
