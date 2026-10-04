import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import enMessages from './src/lib/i18n/locales/en.json';
import trMessages from './src/lib/i18n/locales/tr.json';
import { milkDropPresetsPlugin } from './scripts/vite/milkdrop-presets';

export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop';
  const android = mode === 'android';
  return {
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
      outDir: desktop ? 'dist-desktop' : android ? 'dist-android' : 'dist',
      // The APK is a debug target. Keep bundled app and worker code readable,
      // with original TS/Svelte sources available offline in DevTools.
      ...(android ? { minify: false, cssMinify: false, sourcemap: true } : {}),
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          ...(desktop ? {
            miniPlayer: fileURLToPath(new URL('./mini-player.html', import.meta.url)),
            trayMenu: fileURLToPath(new URL('./tray-menu.html', import.meta.url)),
            trayBubble: fileURLToPath(new URL('./tray-bubble.html', import.meta.url))
          } : {}),
          options: fileURLToPath(new URL('./options.html', import.meta.url)),
          audioCompare: fileURLToPath(new URL('./audio-compare.html', import.meta.url)),
          editor: fileURLToPath(new URL('./editor.html', import.meta.url)),
          converter: fileURLToPath(new URL('./converter.html', import.meta.url)),
          logs: fileURLToPath(new URL('./logs.html', import.meta.url)),
          troubadour: fileURLToPath(new URL('./troubadour.html', import.meta.url)),
          troubadourOptions: fileURLToPath(new URL('./troubadour-options.html', import.meta.url))
        }
      }
    },
    optimizeDeps: {
      // Keep chiptune3 unbundled so its internal AudioWorklet URL resolves to the package runtime files.
      exclude: ['chiptune3']
    },
    resolve: {
      alias: {
        ...(desktop || android ? { 'virtual:pwa-register': fileURLToPath(new URL('./src/platform/pwa-disabled.ts', import.meta.url)) } : {}),
        $platform: fileURLToPath(new URL(desktop ? './src/desktop/platform.ts' : android ? './src/android/platform.ts' : './src/platform/browser.ts', import.meta.url)),
        $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
        chiptune3: fileURLToPath(new URL('./src/lib/vendor/chiptune3/chiptune3.js', import.meta.url))
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
      {
        name: 'emit-chiptune3-runtime',
        apply: 'build',
        generateBundle() {
          // Emit the local runtime, including izci's interactive-interface bridge,
          // at the fixed relative path imported by chiptune3.worklet.js.
          this.emitFile({
            type: 'asset',
            fileName: 'assets/libopenmpt.worklet.js',
            source: readFileSync(
              fileURLToPath(new URL('./src/lib/vendor/chiptune3/libopenmpt.worklet.js', import.meta.url))
            )
          });
        }
      },
      svelte(),
      ...(!desktop && !android ? [VitePWA({
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
                'image/avif': ['.avif']
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
