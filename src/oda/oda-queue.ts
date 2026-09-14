import { getQueueSummaryKind } from '$lib/components/track-list-panel/summaries';
import type { TrackItem } from '$lib/types';
import type { OdaTranslate } from './oda-translate';

/** Match the desktop queue's media-aware count label without its duration. */
export function getOdaQueueCountSummary(items: TrackItem[], translate: OdaTranslate): string {
  const values = { count: items.length };
  switch (getQueueSummaryKind(items)) {
    case 'songs':
      return translate('oda.queue.countSongs', '{count, plural, one {# song} other {# songs}}', values);
    case 'images':
      return translate('oda.queue.countImages', '{count, plural, one {# image} other {# images}}', values);
    case 'videos':
      return translate('oda.queue.countVideos', '{count, plural, one {# video} other {# videos}}', values);
    case 'items':
    default:
      return translate('oda.queue.countItems', '{count, plural, one {# item} other {# items}}', values);
  }
}
