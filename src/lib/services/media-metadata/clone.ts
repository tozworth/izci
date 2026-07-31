import { AttachedFile, RichImageData, type MetadataTags } from 'mediabunny';

type RawValue = NonNullable<MetadataTags['raw']>[string];

function cloneRawValue(value: RawValue): RawValue {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof RichImageData) return new RichImageData(value.data.slice(), value.mimeType);
  if (value instanceof AttachedFile) {
    return new AttachedFile(value.data.slice(), value.mimeType, value.name, value.description);
  }
  if (value && typeof value === 'object') return { ...value };
  return value;
}

export function cloneRawMetadata(raw: MetadataTags['raw']): NonNullable<MetadataTags['raw']> {
  return Object.fromEntries(
    Object.entries(raw ?? {}).map(([key, value]) => [key, cloneRawValue(value)])
  );
}

export function cloneMetadataTags(tags: MetadataTags): MetadataTags {
  return {
    ...tags,
    date: tags.date ? new Date(tags.date.getTime()) : undefined,
    images: tags.images?.map((image) => ({ ...image, data: image.data.slice() })),
    raw: cloneRawMetadata(tags.raw)
  };
}
