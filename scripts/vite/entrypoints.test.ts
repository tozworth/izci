import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const sharedPages = [
  'index.html', 'options.html', 'audio-compare.html', 'editor.html',
  'converter.html', 'logs.html', 'troubadour.html', 'troubadour-options.html'
];
const windowsPages = ['mini-player.html', 'tray-menu.html', 'tray-bubble.html'];

const targets = [
    { mode: 'production', os: undefined, output: 'dist', windows: false },
    { mode: 'desktop', os: 'win32', output: 'dist-desktop', windows: true },
    { mode: 'desktop', os: 'linux', output: 'dist-desktop', windows: false },
    { mode: 'android', os: undefined, output: 'dist-android', windows: false }
];

describe('HTML entrypoint layout', () => {
  it.each(targets.flatMap((target) =>
    (['build', 'serve'] as const).map((command) => ({ ...target, command }))
  ))(
    'preserves root page URLs and module resolution for $command/$mode/$os',
    async ({ mode, os, output, windows, command }) => {
      const previousOs = process.env.IZCI_DESKTOP_OS;
      try {
        if (os) process.env.IZCI_DESKTOP_OS = os;
        const config = await resolveConfig({
          configFile: resolve(projectRoot, 'vite.config.ts'), mode
        }, command);
        const inputs = Object.values(config.build.rollupOptions.input as Record<string, string>);
        expect(inputs.map((path) => relative(config.root, path)).sort()).toEqual(
          [...sharedPages, ...(windows ? windowsPages : [])].sort()
        );
        expect(resolve(config.publicDir)).toBe(resolve(projectRoot, 'public'));
        expect(resolve(config.build.outDir)).toBe(resolve(projectRoot, output));
        expect(config.plugins.some((plugin) => plugin.name === 'vite-plugin-pwa')).toBe(mode === 'production');
        for (const input of inputs) {
          const html = readFileSync(input, 'utf8');
          const entry = html.match(/<script type="module" src="([^"]+)"/);
          expect(entry, input).not.toBeNull();
          const resolvedEntry = await config.createResolver()(entry![1], input);
          expect(resolve(resolvedEntry!), input).toBe(resolve(projectRoot, entry![1].slice(1)));
          expect(existsSync(resolvedEntry!), input).toBe(true);
          expect(html).not.toContain('href="../public/');
        }
      } finally {
        if (previousOs === undefined) delete process.env.IZCI_DESKTOP_OS;
        else process.env.IZCI_DESKTOP_OS = previousOs;
      }
    }
  );
});
