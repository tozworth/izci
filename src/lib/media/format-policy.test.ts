import { describe, expect, it } from 'vitest';
import {
  MODULE_EXTENSIONS,
  STREAM_EXTENSIONS,
  SUPPORTED_MEDIA_EXTENSIONS,
  VIDEO_EXTENSIONS
} from '$lib/contracts/media-format';
import {
  inferMediaExtension,
  inferTrackKind,
  mediaFileInputAccept,
  mediaPickerAccept,
  PWA_MEDIA_FILE_HANDLER_ACCEPT
} from './format-policy';

describe('canonical media format policy', () => {
  it('classifies every internal extension through one policy', () => {
    expect(STREAM_EXTENSIONS.every((extension) => inferTrackKind(extension) === 'stream')).toBe(true);
    expect(MODULE_EXTENSIONS.every((extension) => inferTrackKind(extension) === 'module')).toBe(true);
    expect(VIDEO_EXTENSIONS.every((extension) => inferTrackKind(extension) === 'video')).toBe(true);
    expect(inferTrackKind('unknown')).toBeNull();
    expect(inferMediaExtension('Folder/SONG.MP3')).toBe('mp3');
  });

  it('projects exact picker and input extension sets without drift', () => {
    const input = new Set(mediaFileInputAccept().split(','));
    expect(input).toEqual(new Set(SUPPORTED_MEDIA_EXTENSIONS.map((extension) => `.${extension}`)));
    expect(new Set(mediaPickerAccept(['stream', 'module'], 'wildcard')['audio/*'])).toEqual(
      new Set([...STREAM_EXTENSIONS, ...MODULE_EXTENSIONS].map((extension) => `.${extension}`))
    );
  });

  it('keeps installed-PWA associations conservative', () => {
    const pwaExtensions = Object.values(PWA_MEDIA_FILE_HANDLER_ACCEPT).flat();
    expect(pwaExtensions.every((extension) => mediaFileInputAccept().split(',').includes(extension))).toBe(true);
    expect(pwaExtensions).not.toContain('.mptm');
  });
});
