import { describe, expect, it } from 'vitest';
import {
  parseRenameTemplate,
  renderRenameTemplate,
  sanitizeFilename,
  validateFilename
} from './rename-template';

describe('Troubadour rename templates', () => {
  it('renders padded tokens, transforms, and conditional segments', () => {
    const nodes = parseRenameTemplate('[if:disc]Disc {disc:02} - [/if]{track:02} - {artist|trim} - {title|title}');
    expect(renderRenameTemplate(nodes, {
      disc: 2,
      track: 7,
      artist: '  An Artist ',
      title: 'a small SONG'
    })).toEqual({
      value: 'Disc 02 - 07 - An Artist - A Small Song',
      missing: []
    });
    expect(renderRenameTemplate(nodes, { track: 1, title: 'Song' }).value).toBe('01 -  - Song');
  });

  it('reports missing required tokens while conditionals remain optional', () => {
    const result = renderRenameTemplate(parseRenameTemplate('[if:album]{album} - [/if]{title}'), {});
    expect(result).toEqual({ value: '', missing: ['title'] });
  });

  it('rejects malformed syntax and unknown transforms', () => {
    expect(() => parseRenameTemplate('{title|eval}')).toThrow(/transform/i);
    expect(() => parseRenameTemplate('[if:album]{title}')).toThrow(/unclosed/i);
  });

  it('sanitizes Windows-hostile names deterministically', () => {
    expect(sanitizeFilename(' CON: bad  name. ')).toMatchObject({
      name: 'CON_ bad name',
      changed: true
    });
    expect(sanitizeFilename('NUL').name).toBe('_NUL');
    expect(validateFilename('bad/name.')).toEqual(['illegal-characters', 'trailing-space-or-dot']);
  });

  it('can transliterate and replace non-ASCII filename characters without changing the template', () => {
    expect(sanitizeFilename('Beyoncé 東京', { unicodeNormalization: 'ascii' })).toMatchObject({
      name: 'Beyonce __',
      changed: true,
      problems: ['non-ascii']
    });
  });
});
