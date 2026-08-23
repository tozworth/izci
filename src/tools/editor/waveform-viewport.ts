const MIN_WAVEFORM_ZOOM = 1;
export const MAX_WAVEFORM_ZOOM = 64;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function normalizeWaveformZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_WAVEFORM_ZOOM;
  return clamp(zoom, MIN_WAVEFORM_ZOOM, MAX_WAVEFORM_ZOOM);
}

export function waveformViewportDuration(duration: number, zoom: number): number {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  return safeDuration / normalizeWaveformZoom(zoom);
}

export function clampWaveformScrollStart(start: number, duration: number, zoom: number): number {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const maximum = Math.max(0, safeDuration - waveformViewportDuration(safeDuration, zoom));
  return clamp(Number.isFinite(start) ? start : 0, 0, maximum);
}

export function zoomWaveformViewport(
  start: number,
  duration: number,
  currentZoom: number,
  nextZoom: number,
  anchor = 0.5
): { zoom: number; start: number } {
  const safeAnchor = clamp(Number.isFinite(anchor) ? anchor : 0.5, 0, 1);
  const safeCurrentZoom = normalizeWaveformZoom(currentZoom);
  const zoom = normalizeWaveformZoom(nextZoom);
  const currentStart = clampWaveformScrollStart(start, duration, safeCurrentZoom);
  const anchorTime = currentStart + waveformViewportDuration(duration, safeCurrentZoom) * safeAnchor;
  const nextStart = anchorTime - waveformViewportDuration(duration, zoom) * safeAnchor;
  return { zoom, start: clampWaveformScrollStart(nextStart, duration, zoom) };
}
