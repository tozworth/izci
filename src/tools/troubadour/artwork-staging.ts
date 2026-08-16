import type { MediaArtwork } from '$lib/services/media-metadata/types';
import type {
  TroubadourArtworkKind,
  TroubadourMultipleImageBehavior,
  TroubadourSettings
} from '$lib/stores/troubadour-settings';
import type { TroubadourTranslate } from './troubadour-dock';

/** True when the applied documents carry differing embedded image sets. */
export function artworkMixedAcross(documents: readonly { artwork: readonly MediaArtwork[] }[]): boolean {
  return documents.length > 1 && documents.some((document) =>
    document.artwork.map((artwork) => `${artwork.id}:${artwork.kind}:${artwork.mimeType}:${artwork.size}`).join('|')
      !== documents[0].artwork.map((artwork) => `${artwork.id}:${artwork.kind}:${artwork.mimeType}:${artwork.size}`).join('|')
  );
}

export interface ArtworkStagingTarget {
  settings: TroubadourSettings;
  translate: TroubadourTranslate;
  controller: {
    addArtwork(artwork: MediaArtwork, behavior?: TroubadourMultipleImageBehavior): void;
    replaceArtwork(artworkId: string, artwork: MediaArtwork): void;
    clearArtwork(): void;
    applyArtworkToAlbum(albumId: string, artwork: MediaArtwork, behavior?: TroubadourMultipleImageBehavior): void;
  };
  /** Currently selected artwork across the selection (null when mixed/none). */
  selectedArtwork: MediaArtwork | null;
  /** True when any selected applied document already carries artwork. */
  hasSelectionArtwork: boolean;
  setDragActive(active: boolean): void;
  setError(message: string): void;
}

export async function artworkFromFile(file: File, defaultKind: TroubadourArtworkKind): Promise<MediaArtwork> {
  return {
    id: `pending:${crypto.randomUUID()}`,
    data: new Uint8Array(await file.arrayBuffer()),
    mimeType: file.type || 'image/jpeg',
    kind: defaultKind === 'back' ? 'coverBack' : defaultKind === 'front' ? 'coverFront' : 'unknown',
    name: file.name,
    size: file.size
  };
}

export function stageArtwork(target: ArtworkStagingTarget, artwork: MediaArtwork, mode: 'add' | 'replace'): void {
  if (mode === 'replace' && target.selectedArtwork) {
    target.controller.replaceArtwork(target.selectedArtwork.id, artwork);
    return;
  }
  if (target.settings.multipleImageBehavior === 'reject' && target.hasSelectionArtwork) {
    target.setError(target.translate('troubadour.workbench.multipleArtworkRejected', { default: 'The current artwork policy rejects additional images.' }));
    return;
  }
  target.controller.addArtwork(artwork, target.settings.multipleImageBehavior);
}

export async function addArtworkFile(
  target: ArtworkStagingTarget,
  event: Event,
  mode: 'add' | 'replace'
): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  stageArtwork(target, await artworkFromFile(file, target.settings.defaultArtworkKind), mode);
}

export async function pasteArtwork(target: ArtworkStagingTarget): Promise<void> {
  if (!navigator.clipboard?.read) return;
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((candidate) => candidate.startsWith('image/'));
    if (!type) continue;
    const blob = await item.getType(type);
    stageArtwork(target, await artworkFromFile(new File([blob], 'clipboard-image', { type }), target.settings.defaultArtworkKind), 'add');
    return;
  }
}

export async function dropArtwork(target: ArtworkStagingTarget, event: DragEvent): Promise<void> {
  event.preventDefault();
  event.stopPropagation();
  target.setDragActive(false);
  const file = [...(event.dataTransfer?.files ?? [])].find((candidate) => candidate.type.startsWith('image/'));
  if (file) stageArtwork(target, await artworkFromFile(file, target.settings.defaultArtworkKind), 'add');
}

export function handleArtworkDragOver(event: DragEvent): void {
  if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
}

export function handleArtworkDrop(target: ArtworkStagingTarget, event: DragEvent): void {
  if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
    void dropArtwork(target, event);
  }
}

export function clearArtwork(target: ArtworkStagingTarget, affectedCount: number): void {
  if (affectedCount >= target.settings.destructiveClearConfirmationThreshold && !window.confirm(target.translate('troubadour.workbench.confirmClearArtwork', {
    default: 'Stage removal of all artwork from {count} selected files?',
    values: { count: affectedCount }
  }))) return;
  target.controller.clearArtwork();
}

export function setArtworkKind(
  target: ArtworkStagingTarget,
  kind: MediaArtwork['kind']
): void {
  if (target.selectedArtwork) target.controller.replaceArtwork(target.selectedArtwork.id, { ...target.selectedArtwork, kind });
}

export function applyArtworkToSelectedAlbum(
  target: ArtworkStagingTarget,
  selectedAlbumId: string | null
): void {
  if (target.selectedArtwork && selectedAlbumId) {
    target.controller.applyArtworkToAlbum(selectedAlbumId, target.selectedArtwork, target.settings.multipleImageBehavior);
  }
}

export async function copyArtwork(selectedArtwork: MediaArtwork | null): Promise<void> {
  if (!selectedArtwork || !('ClipboardItem' in window)) return;
  const blob = new Blob([selectedArtwork.data.slice().buffer], { type: selectedArtwork.mimeType });
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

export function extractArtwork(selectedArtwork: MediaArtwork | null): void {
  if (!selectedArtwork) return;
  const blob = new Blob([selectedArtwork.data.slice().buffer], { type: selectedArtwork.mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = selectedArtwork.name || `cover.${selectedArtwork.mimeType.split('/')[1] || 'bin'}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
