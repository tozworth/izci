import type { MediaMetadataFieldName } from '$lib/services/media-metadata/types';
import { STREAM_EXTENSIONS, type MenuActionItem } from '$lib/types';
import { isItemDrag, ITEM_DRAG_MIME } from './troubadour-imports';
import type { TroubadourAlbum, TroubadourWorkbenchItem } from './troubadour-controller';
import type { TroubadourTranslate } from './troubadour-dock';

/**
 * Item-table presentation helpers for the workbench. These stay script-side
 * until the row markup grows enough to justify a TroubadourRow.svelte split.
 */
export function isSpectrogramItem(item: TroubadourWorkbenchItem | null | undefined): boolean {
  return Boolean(item && (STREAM_EXTENSIONS as readonly string[]).includes(item.extension));
}

export function stateIcon(item: TroubadourWorkbenchItem): string {
  if (item.state === 'loading' || item.state === 'saving') return 'progress_activity';
  if (item.state === 'dirty') return 'edit';
  if (item.state === 'saved') return 'check_circle';
  if (item.state === 'unsupported') return 'visibility';
  if (item.state === 'failed' || item.state === 'unreadable' || item.state === 'conflicted') return 'error';
  if (item.state === 'permission-required') return 'lock';
  return 'audio_file';
}

export function stateText(item: TroubadourWorkbenchItem): string {
  if (item.error) return item.error;
  return item.state.replace('-', ' ');
}

export function fieldLabel(field: MediaMetadataFieldName, translate: TroubadourTranslate): string {
  switch (field) {
    case 'title': return translate('troubadour.fields.title', { default: 'Title' });
    case 'artist': return translate('troubadour.fields.artist', { default: 'Artist' });
    case 'albumArtist': return translate('troubadour.fields.albumArtist', { default: 'Album artist' });
    case 'album': return translate('troubadour.fields.album', { default: 'Album' });
    case 'date': return translate('troubadour.fields.date', { default: 'Date' });
    case 'trackNumber': return translate('troubadour.fields.trackNumber', { default: 'Track number' });
    case 'tracksTotal': return translate('troubadour.fields.tracksTotal', { default: 'Track total' });
    case 'discNumber': return translate('troubadour.fields.discNumber', { default: 'Disc number' });
    case 'discsTotal': return translate('troubadour.fields.discsTotal', { default: 'Disc total' });
    case 'genre': return translate('troubadour.fields.genre', { default: 'Genre' });
    case 'composer': return translate('troubadour.fields.composer', { default: 'Composer' });
    case 'comment': return translate('troubadour.fields.comment', { default: 'Comment' });
    case 'lyrics': return translate('troubadour.fields.lyrics', { default: 'Lyrics' });
    case 'isrc': return 'ISRC';
    case 'bpm': return 'BPM';
    case 'grouping': return translate('troubadour.fields.grouping', { default: 'Grouping' });
    case 'copyright': return translate('troubadour.fields.copyright', { default: 'Copyright' });
    case 'titleSort': return translate('troubadour.fields.titleSort', { default: 'Title sort' });
    case 'artistSort': return translate('troubadour.fields.artistSort', { default: 'Artist sort' });
    case 'albumSort': return translate('troubadour.fields.albumSort', { default: 'Album sort' });
    case 'albumArtistSort': return translate('troubadour.fields.albumArtistSort', { default: 'Album artist sort' });
    case 'composerSort': return translate('troubadour.fields.composerSort', { default: 'Composer sort' });
  }
}

export function buildContextMenuItems(
  item: TroubadourWorkbenchItem | null | undefined,
  albums: TroubadourAlbum[],
  translate: TroubadourTranslate
): MenuActionItem[] {
  return [
    { id: 'copyPath', label: translate('troubadour.workbench.copyPath', { default: 'Copy path' }), icon: 'content_copy', disabled: !item?.path },
    { id: 'spectrogram', label: translate('troubadour.menu.spectrogram', { default: 'Open selected file in Spectrogram' }), icon: 'waterfall_chart', disabled: !isSpectrogramItem(item), separatorBefore: true },
    { id: 'createAlbum', label: translate('troubadour.menu.createAlbum', { default: 'Create album from selection' }), icon: 'create_new_folder', separatorBefore: true },
    ...albums.map((album, index) => ({
      id: `assign:${album.id}`,
      label: translate('troubadour.workbench.assignToAlbum', { default: 'Assign to {album}', values: { album: album.title } }),
      icon: 'album',
      separatorBefore: index === 0
    })),
    { id: 'remove', label: translate('troubadour.menu.remove', { default: 'Remove from workbench' }), icon: 'remove', separatorBefore: true }
  ];
}

export interface TroubadourAlbumDragTarget {
  /** Currently hovered album id, read by the drag-leave handler. */
  dragAlbumId: string | null;
  setDragAlbumId(id: string | null): void;
  assignItemsToAlbum(itemIds: string[], albumId: string): void;
}

export function dragOverAlbum(target: TroubadourAlbumDragTarget, event: DragEvent, album: TroubadourAlbum): void {
  if (!isItemDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  target.setDragAlbumId(album.id);
}

export function leaveAlbum(target: TroubadourAlbumDragTarget, event: DragEvent, album: TroubadourAlbum): void {
  const pane = event.currentTarget as HTMLElement;
  if (event.relatedTarget instanceof Node && pane.contains(event.relatedTarget)) return;
  if (target.dragAlbumId === album.id) target.setDragAlbumId(null);
}

export function dropOnAlbum(target: TroubadourAlbumDragTarget, event: DragEvent, album: TroubadourAlbum): void {
  if (!isItemDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  target.setDragAlbumId(null);
  try {
    const itemIds = JSON.parse(event.dataTransfer?.getData(ITEM_DRAG_MIME) ?? '[]');
    if (Array.isArray(itemIds)) target.assignItemsToAlbum(itemIds.filter((id): id is string => typeof id === 'string'), album.id);
  } catch {
    // Ignore malformed internal drag data.
  }
}
