import type { AttachedImage } from 'mediabunny';
import type { ArtworkEdit, MediaArtwork, MediaArtworkInput } from './types';
import { MetadataWriteError } from './types';

function byteHash(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of data) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function imageDimensions(data: Uint8Array, mimeType: string): { width?: number; height?: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (mimeType.toLowerCase() === 'image/png' && data.byteLength >= 24) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mimeType.toLowerCase() === 'image/gif' && data.byteLength >= 10) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (mimeType.toLowerCase() === 'image/webp' && data.byteLength >= 30) {
    const chunk = String.fromCharCode(data[12], data[13], data[14], data[15]);
    if (chunk === 'VP8X') {
      const width = 1 + data[24] + data[25] * 256 + data[26] * 65536;
      const height = 1 + data[27] + data[28] * 256 + data[29] * 65536;
      return { width, height };
    }
  }
  if ((mimeType.toLowerCase() === 'image/jpeg' || mimeType.toLowerCase() === 'image/jpg')
    && data.byteLength >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.byteLength) {
      if (data[offset] !== 0xff) { offset += 1; continue; }
      const marker = data[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + length + 2 > data.byteLength) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += length + 2;
    }
  }
  return {};
}

function materializeArtwork(input: MediaArtworkInput, id: string): MediaArtwork {
  const data = input.data.slice();
  return {
    ...input,
    data,
    id,
    size: data.byteLength,
    ...imageDimensions(data, input.mimeType)
  };
}

function validateArtworkInput(input: MediaArtworkInput): void {
  if (!(input?.data instanceof Uint8Array) || input.data.byteLength === 0) {
    throw new MetadataWriteError('invalid-patch', 'Artwork must contain image bytes.');
  }
  if (typeof input.mimeType !== 'string' || !/^image\/[a-z0-9.+-]+$/i.test(input.mimeType)) {
    throw new MetadataWriteError('invalid-patch', 'Artwork must have an image MIME type.');
  }
  if (!['coverFront', 'coverBack', 'unknown'].includes(input.kind)) {
    throw new MetadataWriteError('invalid-patch', 'Artwork has an unsupported kind.');
  }
  if (input.name !== undefined && typeof input.name !== 'string') {
    throw new MetadataWriteError('invalid-patch', 'Artwork names must be strings.');
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    throw new MetadataWriteError('invalid-patch', 'Artwork descriptions must be strings.');
  }
}

export function readArtwork(images: readonly AttachedImage[] | undefined): readonly MediaArtwork[] {
  return (images ?? []).map((image, index) => materializeArtwork(
    image,
    `source:${index}:${byteHash(image.data)}`
  ));
}

export function applyArtworkEdits(
  original: readonly MediaArtwork[],
  edits: ArtworkEdit | readonly ArtworkEdit[] | undefined
): readonly MediaArtwork[] {
  const result = original.map((image) => materializeArtwork(image, image.id));
  if (!edits) return result;
  const list = Array.isArray(edits) ? edits : [edits];
  let added = 0;
  for (const edit of list) {
    if (edit.type === 'clear') {
      result.splice(0);
      continue;
    }
    if (edit.type === 'add') {
      validateArtworkInput(edit.artwork);
      const image = materializeArtwork(edit.artwork, `added:${byteHash(edit.artwork.data)}:${added++}`);
      if (!edit.beforeId) result.push(image);
      else {
        const index = result.findIndex((candidate) => candidate.id === edit.beforeId);
        if (index < 0) throw new MetadataWriteError('invalid-patch', `Artwork slot ${edit.beforeId} no longer exists.`);
        result.splice(index, 0, image);
      }
      continue;
    }
    const index = result.findIndex((candidate) => candidate.id === edit.targetId);
    if (index < 0) throw new MetadataWriteError('invalid-patch', `Artwork slot ${edit.targetId} no longer exists.`);
    if (edit.type === 'remove') result.splice(index, 1);
    else {
      validateArtworkInput(edit.artwork);
      result[index] = materializeArtwork(edit.artwork, edit.targetId);
    }
  }
  return result;
}

export function artworkToAttachedImages(images: readonly MediaArtwork[]): AttachedImage[] {
  return images.map(({ data, mimeType, kind, name, description }) => ({
    data: data.slice(), mimeType, kind, name, description
  }));
}
