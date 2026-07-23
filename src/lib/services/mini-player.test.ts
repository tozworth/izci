import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installMiniPlayerMaterialSymbols,
  minimizeMiniPlayerOpener,
  supportsMiniPlayer
} from './mini-player';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('supportsMiniPlayer', () => {
  it('detects the requestWindow capability', () => {
    expect(supportsMiniPlayer({
      documentPictureInPicture: { requestWindow: async () => ({}) as Window }
    } as unknown as Window)).toBe(true);
  });

  it('rejects absent and incomplete implementations', () => {
    expect(supportsMiniPlayer(undefined)).toBe(false);
    expect(supportsMiniPlayer({} as Window)).toBe(false);
  });
});

describe('minimizeMiniPlayerOpener', () => {
  it('minimizes a capable opener window', async () => {
    let minimizeCalls = 0;

    await expect(minimizeMiniPlayerOpener({
      minimize: async () => {
        minimizeCalls += 1;
      }
    })).resolves.toBe(true);
    expect(minimizeCalls).toBe(1);
  });

  it('degrades when minimization is unavailable or denied', async () => {
    await expect(minimizeMiniPlayerOpener(undefined)).resolves.toBe(false);
    await expect(minimizeMiniPlayerOpener({
      minimize: async () => {
        throw new DOMException('Permission denied.', 'NotAllowedError');
      }
    })).resolves.toBe(false);
  });
});

describe('installMiniPlayerMaterialSymbols', () => {
  it('materializes the font in the target document without a target-window request', async () => {
    const fontData = new ArrayBuffer(8);
    const addedFonts: unknown[] = [];
    const deletedFonts: unknown[] = [];
    const appendedStyles: Array<{ textContent: string; remove: ReturnType<typeof vi.fn> }> = [];

    class TestFontFace {
      constructor(
        public family: string,
        public source: string | ArrayBuffer,
        public descriptors?: FontFaceDescriptors
      ) {}

      async load(): Promise<this> {
        return this;
      }
    }

    vi.stubGlobal('FontFace', TestFontFace);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => fontData
    })));

    const target = {
      fonts: {
        add: (font: unknown) => addedFonts.push(font),
        delete: (font: unknown) => {
          deletedFonts.push(font);
          return true;
        }
      },
      createElement: () => ({ textContent: '', remove: vi.fn() }),
      head: {
        append: (style: { textContent: string; remove: ReturnType<typeof vi.fn> }) => {
          appendedStyles.push(style);
        }
      }
    } as unknown as Document;

    const release = await installMiniPlayerMaterialSymbols(target);

    expect(fetch).toHaveBeenCalledOnce();
    expect(addedFonts).toHaveLength(1);
    expect(addedFonts[0]).toMatchObject({
      family: 'izci Mini Player Material Symbols',
      source: fontData
    });
    expect(appendedStyles[0]?.textContent).toContain('izci Mini Player Material Symbols');

    release();

    expect(appendedStyles[0]?.remove).toHaveBeenCalledOnce();
    expect(deletedFonts).toEqual(addedFonts);
  });
});
