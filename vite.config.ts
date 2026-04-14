import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  preview: {
    allowedHosts: true
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        options: fileURLToPath(new URL('./options.html', import.meta.url))
      }
    }
  },
  optimizeDeps: {
    // Keep chiptune3 unbundled so its internal AudioWorklet URL resolves to the package runtime files.
    exclude: ['chiptune3']
  },
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
    }
  },
  plugins: [
    {
      name: 'emit-chiptune3-runtime',
      apply: 'build',
      generateBundle() {
        // chiptune3.worklet.js imports this file with a fixed relative path, so it must be emitted unchanged.
        this.emitFile({
          type: 'asset',
          fileName: 'assets/libopenmpt.worklet.js',
          source: readFileSync(
            fileURLToPath(new URL('./node_modules/chiptune3/libopenmpt.worklet.js', import.meta.url))
          )
        });
      }
    },
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/izci-icon.svg', 'icons/izci-maskable.svg'],
      manifest: {
        name: 'izci',
        short_name: 'izci',
        description: 'Offline-first PWA music player with tracker module support.',
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
            action: '/',
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
              'audio/x-mo3': ['.mo3']
            }
          }
        ]
      } as Record<string, unknown>,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mem}'],
        navigateFallbackDenylist: [/^\/options\.html(?:\?|$)/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      }
    })
  ]
});
