import { writable } from 'svelte/store';

/** Clockwise image rotation in degrees. CSS-only and never persisted. */
export type ImageRotation = 0 | 90 | 180 | 270;

export const IMAGE_ROTATION_ORIGIN: ImageRotation = 0;

const ROTATION_STEPS: ImageRotation[] = [0, 90, 180, 270];

export function normalizeImageRotation(value: unknown): ImageRotation {
  if (value === 90 || value === 180 || value === 270) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const wrapped = ((Math.round(value) % 360) + 360) % 360;
    const snapped = ROTATION_STEPS.reduce<ImageRotation>(
      (closest, step) =>
        Math.abs(step - wrapped) < Math.abs(closest - wrapped) ? step : closest,
      0
    );
    return snapped;
  }

  return IMAGE_ROTATION_ORIGIN;
}

/** Returns true for quarter turns that swap the rendered width/height. */
export function isSidewaysRotation(rotation: ImageRotation): boolean {
  return rotation === 90 || rotation === 270;
}

/**
 * Extra scale factor so a sideways (90/270) image still fits its stage at
 * 1x zoom. The stage element keeps its unrotated layout box, so without this
 * a wide image rotated upright would overflow top/bottom. The factor is the
 * ratio of the rotated contain-fit scale to the unrotated contain-fit scale;
 * multiply it with the zoom level. Pure helper to stay testable.
 */
export function rotationFitScale(
  rotation: ImageRotation,
  hostWidth: number,
  hostHeight: number,
  naturalWidth: number,
  naturalHeight: number
): number {
  if (!isSidewaysRotation(normalizeImageRotation(rotation))) {
    return 1;
  }

  const dims = [hostWidth, hostHeight, naturalWidth, naturalHeight];
  if (!dims.every((value) => Number.isFinite(value) && value > 0)) {
    return 1;
  }

  const containScale = Math.min(hostWidth / naturalWidth, hostHeight / naturalHeight);
  if (!(containScale > 0)) {
    return 1;
  }

  const rotatedContainScale = Math.min(hostWidth / naturalHeight, hostHeight / naturalWidth);
  return rotatedContainScale / containScale;
}

/**
 * Transient (never persisted) clockwise rotation shared by the media-tab and
 * theater image stages so rotation survives theater toggles. Track changes
 * reset it through the video window actions. The image file is never
 * modified; rotation is a CSS transform only.
 */
export const imageRotation = writable<ImageRotation>(IMAGE_ROTATION_ORIGIN);

export function rotateImageClockwise(): void {
  imageRotation.update((current) => {
    const next = ROTATION_STEPS[(ROTATION_STEPS.indexOf(normalizeImageRotation(current)) + 1) % ROTATION_STEPS.length];
    return next ?? IMAGE_ROTATION_ORIGIN;
  });
}

export function resetImageRotation(): void {
  imageRotation.set(IMAGE_ROTATION_ORIGIN);
}
