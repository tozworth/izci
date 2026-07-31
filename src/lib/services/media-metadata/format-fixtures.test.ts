import { describe, expect, it } from 'vitest';
import { applyMetadataPatch } from './merge';
import { readMetadataDocument } from './reader';
import { remuxMetadataToBlob } from './remux';

// Tiny generated silence fixtures keep these remux tests independent of runtime encoders.
const FIXTURES = {
  flac: 'ZkxhQwAAACIAwADAAAALAAAMAfQA8AAAAZBrQxvy2nyTErPlwh5n9lkbhAAALAwAAABMYXZmNjIuMS4xMDABAAAAFAAAAGVuY29kZXI9TGF2ZjYyLjEuMTAw//gUCAArAAAA6Vv/+BQIASwAAACFI//4ZAgCD+QAAAB2ig==',
  mp3: 'SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYyLjEuMTAwAAAAAAAAAAAAAAD/+xDEAAPAAAGkAAAAIAAANIAAAARMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EsQpg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMRTg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
  opus: 'T2dnUwACAAAAAAAAAAC3Hb/zAAAAAGrcH6cBE09wdXNIZWFkAQE4AUAfAAAAAABPZ2dTAAAAAAAAAAAAALcdv/MBAAAAttW46AE8T3B1c1RhZ3MMAAAATGF2ZjYyLjEuMTAwAQAAABwAAABlbmNvZGVyPUxhdmM2Mi4zLjEwMSBsaWJvcHVzT2dnUwAEmAoAAAAAAAC3Hb/zAgAAAL7lPgwDBwYGCAvmOyOrYAgIrLMOxggIrLMOxg=='
} as const;

function fixtureFile(extension: keyof typeof FIXTURES): File {
  const binary = atob(FIXTURES[extension]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new File([bytes], `silence.${extension}`, { type: `audio/${extension}`, lastModified: 123 });
}

describe('metadata format fixtures', () => {
  it.each(['mp3', 'flac', 'opus'] as const)('remuxes and rereads %s metadata', async (extension) => {
    const source = fixtureFile(extension);
    const document = await readMetadataDocument(source, extension);
    const applied = applyMetadataPatch(document, { title: `Tagged ${extension}`, composer: 'Fixture composer' });
    const tagged = await remuxMetadataToBlob(source, extension, applied.tags);
    const result = await readMetadataDocument(
      new File([tagged], source.name, { type: tagged.type, lastModified: 456 }),
      extension
    );
    expect(result.fields.title).toBe(`Tagged ${extension}`);
    expect(result.fields.composer).toBe('Fixture composer');
  });
});
