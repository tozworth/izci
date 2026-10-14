/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import enMessages from './src/lib/i18n/locales/en.json';
import trMessages from './src/lib/i18n/locales/tr.json';
import { milkDropPresetsPlugin } from './scripts/vite/milkdrop-presets';

export default defineConfig(({ mode }) => {
  const platform = mode === 'desktop' ? 'desktop' : mode === 'android' ? 'android' : 'pwa';
  const desktop = platform === 'desktop';
  const linux = desktop && (process.env.IZCI_DESKTOP_OS ?? process.platform) === 'linux';
  const android = platform === 'android';
  const platformEntries = {
    pwa: './src/platform/pwa/platform.ts',
    desktop: linux ? './src/desktop/linux/platform.ts' : './src/desktop/platform.ts',
    android: './src/android/platform.ts'
  };
  return {
    // A dedicated HTML root keeps source pages grouped without changing window URLs.
    root: fileURLToPath(new URL('./pages', import.meta.url)),
    publicDir: fileURLToPath(new URL('./public', import.meta.url)),
    cacheDir: fileURLToPath(new URL('./node_modules/.vite', import.meta.url)),
    test: {
      root: fileURLToPath(new URL('.', import.meta.url))
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: ['localhost', 'badomen.dala-pierce.ts.net'],
    },
    preview: {
      allowedHosts: true
    },
    worker: {
      format: 'es'
    },
    build: {
      outDir: fileURLToPath(new URL(desktop ? './dist-desktop' : android ? './dist-android' : './dist', import.meta.url)),
      emptyOutDir: true,
      // The APK is a debug target. Keep bundled app and worker code readable,
      // with original TS/Svelte sources available offline in DevTools.
      ...(android ? { minify: false, cssMinify: false, sourcemap: true } : {}),
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL('./pages/index.html', import.meta.url)),
          ...(desktop && !linux ? {
            miniPlayer: fileURLToPath(new URL('./pages/mini-player.html', import.meta.url)),
            trayMenu: fileURLToPath(new URL('./pages/tray-menu.html', import.meta.url)),
            trayBubble: fileURLToPath(new URL('./pages/tray-bubble.html', import.meta.url))
          } : {}),
          options: fileURLToPath(new URL('./pages/options.html', import.meta.url)),
          audioCompare: fileURLToPath(new URL('./pages/audio-compare.html', import.meta.url)),
          editor: fileURLToPath(new URL('./pages/editor.html', import.meta.url)),
          converter: fileURLToPath(new URL('./pages/converter.html', import.meta.url)),
          logs: fileURLToPath(new URL('./pages/logs.html', import.meta.url)),
          troubadour: fileURLToPath(new URL('./pages/troubadour.html', import.meta.url)),
          troubadourOptions: fileURLToPath(new URL('./pages/troubadour-options.html', import.meta.url))
        }
      }
    },
    resolve: {
      alias: {
        '/src': fileURLToPath(new URL('./src', import.meta.url)),
        $platform: fileURLToPath(new URL(platformEntries[platform], import.meta.url)),
        $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
      }
    },
    plugins: [
      milkDropPresetsPlugin(),
      ...(android ? [{
        name: 'android-debug-build',
        generateBundle() {
          this.emitFile({
            type: 'asset' as const,
            fileName: 'android-debug.json',
            source: JSON.stringify({ development: process.env.NODE_ENV === 'development', minified: false, sourcemaps: true })
          });
        }
      } satisfies Plugin] : []),
      svelte({ configFile: fileURLToPath(new URL('./svelte.config.js', import.meta.url)) }),
      ...(platform === 'pwa' ? [VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/izci-icon.svg', 'icons/izci-maskable.svg', 'icons/izci-file.png'],
        manifest: {
          lang: 'en',
          dir: 'ltr',
          name: 'izci',
          short_name: 'izci',
          description: enMessages.pwa.description,
          description_localized: {
            tr: { value: trMessages.pwa.description, lang: 'tr', dir: 'ltr' }
          },
          theme_color: '#1c1d1e',
          background_color: '#0d1118',
          display: 'standalone',
          display_override: ['window-controls-overlay'],
          start_url: '/',
          scope: '/',
          launch_handler: {
            client_mode: 'focus-existing'
          },
          icons: [
            {
              src: '/icons/izci-icon.svg',
              sizes: 'any',
              type: 'image/svg+xml'
            },
            {
              src: '/icons/izci-maskable.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'maskable'
            }
          ],
          file_handlers: [
            {
              // The query marker lets a cold file-association launch synchronously
              // veil its first paint until the launchQueue handles resolve kinds.
              action: '/?filelaunch',
              icons: [
                {
                  src: '/icons/izci-file.png',
                  sizes: '512x512',
                  type: 'image/png'
                }
              ],
              accept: {
                'audio/mpeg': ['.mp3'],
                'audio/wav': ['.wav'],
                'audio/flac': ['.flac'],
                'audio/ogg': ['.ogg', '.opus'],
                'audio/opus': ['.opus'],
                'audio/x-mod': ['.mod'],
                'audio/x-xm': ['.xm'],
                'audio/x-s3m': ['.s3m'],
                'audio/x-it': ['.it'],
                'audio/x-mo3': ['.mo3'],
                'audio/x-hivelytracker': ['.ahx', '.hvl'],
                'video/mp4': ['.mp4', '.m4v'],
                'video/quicktime': ['.mov'],
                'video/webm': ['.webm'],
                'video/x-matroska': ['.mkv'],
                'image/jpeg': ['.jpg', '.jpeg'],
                'image/png': ['.png'],
                'image/webp': ['.webp'],
                'image/avif': ['.avif'],
                'image/jxl': ['.jxl']
              }
            }
          ]
        } as Record<string, unknown>,
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2,mem,wasm,txt}'],
          navigateFallbackDenylist: [
            /^\/(?:options|audio-compare|editor|converter|logs|troubadour|troubadour-options)\.html(?:\?|$)/
          ],
          ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^view$/],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
        }
      })] : [])
    ]
  };
});
