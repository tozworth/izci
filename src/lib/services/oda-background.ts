/**
 * Custom Oda background image loading.
 *
 * The data URL is stored on the synchronized Oda settings (localStorage), so
 * the rendition is deliberately bounded: images are downscaled to a maximum
 * edge and re-encoded as JPEG to stay well under storage quota. The result is
 * rebuildable from the user's source file at any time.
 */

export const ODA_BACKGROUND_IMAGE_MAX_EDGE_PX = 1920;
export const ODA_BACKGROUND_IMAGE_JPEG_QUALITY = 0.82;

export function isOdaBackgroundImage(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('undecodable-image'));
    image.src = url;
  });
}

/**
 * Read an image file into a bounded JPEG data URL for Oda background use.
 * Resolves to null when the file cannot be decoded.
 */
export async function readOdaBackgroundImage(file: File): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (!file.type.startsWith('image/')) return null;

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(sourceUrl).catch(() => null);
    if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;

    const scale = Math.min(
      1,
      ODA_BACKGROUND_IMAGE_MAX_EDGE_PX / Math.max(image.naturalWidth, image.naturalHeight)
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', ODA_BACKGROUND_IMAGE_JPEG_QUALITY);
    return isOdaBackgroundImage(dataUrl) ? dataUrl : null;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
