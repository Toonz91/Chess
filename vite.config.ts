import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Relative base so the same build works at the domain root and under a
// GitHub Pages sub-path (https://toonz91.github.io/Chess/).
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      // Registration is done in src/ui/UpdateToast.tsx (virtual:pwa-register/react).
      injectRegister: false,
      // Icons, engine and app shell are all covered by workbox.globPatterns below.
      includeManifestIcons: false,
      manifest: {
        name: 'Chess Tutor',
        short_name: 'Chess Tutor',
        description: 'Play Stockfish with a real-time chess coach that explains your mistakes.',
        display: 'standalone',
        start_url: './',
        scope: './',
        orientation: 'any',
        theme_color: '#ffffff',
        background_color: '#f4f5f7',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + the Stockfish engine (JS + WASM) so a full game with analysis works offline.
        globPatterns: ['**/*.{js,css,html,wasm,png,svg}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});
