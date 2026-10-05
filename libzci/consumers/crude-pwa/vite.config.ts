import { defineConfig } from 'vite';

// Independent crude consumer: dedicated origin/port, own build
// directory, no shared scope with the main izci app. Ordinary proof
// page in Phase 1.3 — manifest/SW/install support lands in 3.4.
export default defineConfig({
  server: {
    port: 5197,
    strictPort: true,
  },
  preview: {
    port: 5197,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
