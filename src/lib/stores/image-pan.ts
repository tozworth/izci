import { writable } from 'svelte/store';

export interface ImagePanOffset {
  x: number;
  y: number;
}

export interface ImagePanBounds {
  hostWidth: number;
  hostHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  fitMode: 'contain' | 'cover';
  zoom: number;
}

export const IMAGE_PAN_ORIGIN: ImagePanOffset = { x: 0, y: 0 };
const IMAGE_PAN_LIMIT = 8192;

function normalizePanAxis(value: unknown): number {
  const axis = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  return Math.min(Math.max(axis, -IMAGE_PAN_LIMIT), IMAGE_PAN_LIMIT);
}

export function normalizeImagePanOffset(value: unknown): ImagePanOffset {
  const source = value && typeof value === 'object' ? (value as Partial<ImagePanOffset>) : {};
  return {
    x: normalizePanAxis(source.x),
    y: normalizePanAxis(source.y)
  };
}

/**
 * Clamps a pan offset so the zoomed image cannot be dragged past its own
 * edges. At 1x (or when dimensions are unknown) the offset collapses to the
 * origin. Pure helper so drag handling stays testable.
 */
export function clampImagePanOffset(pan: ImagePanOffset, bounds: ImagePanBounds): ImagePanOffset {
  const { hostWidth, hostHeight, naturalWidth, naturalHeight, fitMode, zoom } = bounds;

  if (
    !Number.isFinite(hostWidth) || !Number.isFinite(hostHeight) ||
    !Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) ||
    !Number.isFinite(zoom) || zoom <= 1 ||
    hostWidth <= 0 || hostHeight <= 0 || naturalWidth <= 0 || naturalHeight <= 0
  ) {
    return { ...IMAGE_PAN_ORIGIN };
  }

  const baseScale = fitMode === 'cover'
    ? Math.max(hostWidth / naturalWidth, hostHeight / naturalHeight)
    : Math.min(hostWidth / naturalWidth, hostHeight / naturalHeight);
  const maxX = Math.max(0, (naturalWidth * baseScale * zoom - hostWidth) / 2);
  const maxY = Math.max(0, (naturalHeight * baseScale * zoom - hostHeight) / 2);

  return normalizeImagePanOffset({
    x: Math.min(Math.max(pan.x, -maxX), maxX),
    y: Math.min(Math.max(pan.y, -maxY), maxY)
  });
}

/**
 * Transient (never persisted) pan offset shared by the media-tab and theater
 * image stages so panning survives theater toggles. Zoom-out and track
 * changes reset it through the video window actions.
 */
export const imagePan = writable<ImagePanOffset>({ ...IMAGE_PAN_ORIGIN });

export function resetImagePan(): void {
  imagePan.set({ ...IMAGE_PAN_ORIGIN });
}
