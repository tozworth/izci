/** Keep portrait/panorama outliers useful in a dense collage. */
export function resolveGalleryAspectRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 4 / 3;
  return Math.min(Math.max(width / height, 0.5), 2.4);
}
