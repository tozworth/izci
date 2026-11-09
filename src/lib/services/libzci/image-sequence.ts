/**
 * Svelte-side boundary for core captured image navigation.
 *
 * The Rust owner (`Profile.image_sequence`, `images::ImageSession`) remains
 * the only sequence authority. This module pins the `ImageSequence` and
 * `ImageNavigation` shapes used by the future owner worker when capturing an
 * `image_sequence(query)` page and driving viewer navigation outside the
 * music queue. Neither sequence nor viewer state is persisted or routed
 * through music transport.
 *
 * Shapes mirror the Rust `images::ImageSequence`/`ImageNavigation` structs.
 */

export type CoreImageNavigation =
  | { kind: 'refresh' }
  | { kind: 'previous' }
  | { kind: 'next' }
  | { kind: 'first' }
  | { kind: 'last' }
  | { kind: 'select'; media: number };

export interface CoreImageSequence {
  revision: number;
  media: number[];
}

export const IMAGE_SEQUENCE_MAX_ID = 9_007_199_254_740_991;
export const IMAGE_SEQUENCE_MAX_MEDIA = 100_000;

function isValidId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= IMAGE_SEQUENCE_MAX_ID
  );
}

/** Validate a captured sequence before feeding it to viewer state. */
export function validateImageSequence(sequence: CoreImageSequence): void {
  if (
    !Number.isSafeInteger(sequence.revision) ||
    sequence.revision < 0 ||
    sequence.revision > IMAGE_SEQUENCE_MAX_ID
  ) {
    throw new Error(`Invalid image sequence revision: ${String(sequence.revision)}`);
  }
  if (
    !Array.isArray(sequence.media) ||
    sequence.media.length === 0 ||
    sequence.media.length > IMAGE_SEQUENCE_MAX_MEDIA
  ) {
    throw new Error(
      `Invalid image sequence size: expected 1..${IMAGE_SEQUENCE_MAX_MEDIA} media ids`
    );
  }
  const seen = new Set<number>();
  for (const media of sequence.media) {
    if (!isValidId(media)) throw new Error(`Invalid image sequence media: ${String(media)}`);
    if (seen.has(media)) throw new Error(`Duplicate image sequence media: ${String(media)}`);
    seen.add(media);
  }
}

function validateNavigationTarget(media: number): void {
  if (!isValidId(media)) throw new Error(`Invalid image navigation media: ${String(media)}`);
}

const NAVIGATION_KINDS = new Set(['refresh', 'previous', 'next', 'first', 'last', 'select']);

/** Validate a navigation command before posting it to the owner worker. */
export function validateImageNavigation(navigation: CoreImageNavigation): void {
  if (!navigation || typeof navigation.kind !== 'string' || !NAVIGATION_KINDS.has(navigation.kind)) {
    throw new Error(`Invalid image navigation kind: ${String((navigation as { kind?: unknown } | null)?.kind)}`);
  }
  if (navigation.kind === 'select') {
    validateNavigationTarget((navigation as { media: number }).media);
  }
}

/** Index of a media id in a captured sequence, or -1 when absent. */
export function imageSequenceIndexOf(sequence: CoreImageSequence, media: number): number {
  return sequence.media.indexOf(media);
}

/**
 * Resolve the next media id for step navigation with optional wrap.
 * Returns `null` at the boundary when wrapping is off.
 */
export function stepImageSequence(
  sequence: CoreImageSequence,
  current: number | null,
  direction: 1 | -1,
  wrap: boolean
): number | null {
  const index = current === null ? -1 : imageSequenceIndexOf(sequence, current);
  if (index < 0) {
    return direction === 1 ? (sequence.media[0] ?? null) : (sequence.media[sequence.media.length - 1] ?? null);
  }
  const next = index + direction;
  if (next < 0 || next >= sequence.media.length) {
    if (!wrap) return null;
    return direction === 1 ? (sequence.media[0] ?? null) : (sequence.media[sequence.media.length - 1] ?? null);
  }
  return sequence.media[next] ?? null;
}

/** Serialize navigation for the owner-worker image channel. */
export function serializeImageNavigation(navigation: CoreImageNavigation): string {
  validateImageNavigation(navigation);
  return JSON.stringify(navigation);
}
