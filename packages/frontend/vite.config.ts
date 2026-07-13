/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Production builds must have an explicit API base URL so we never fall back
  // to a hardcoded domain. Dev uses the Vite proxy at /api automatically.
  if (mode === 'production' && !process.env.VITE_API_BASE_URL) {
    throw new Error(
      'Missing required environment variable VITE_API_BASE_URL. ' +
        'Set it in your Cloudflare Pages production environment variables or local .env file.',
    );
  }

  return {
    define: {
      'import.meta.env.VITE_FEATURE_FRONTEND_AUTO_DESTROY': JSON.stringify(
        process.env.VITE_FEATURE_FRONTEND_AUTO_DESTROY || 'true',
      ),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
        manifest: {
          name: 'filesync',
          short_name: 'Files',
          description: 'Secure ephemeral file sharing & chat',
          theme_color: '#faf9f5',
          background_color: '#181715',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
            { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // Handles notificationclick for notifications shown via
          // ServiceWorkerRegistration.showNotification (see useRoomNotifications).
          importScripts: ['sw-notification-click.js'],
          runtimeCaching: [
            {
              urlPattern: /^\/api\/.*/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                networkTimeoutSeconds: 10,
                expiration: { maxEntries: 50, maxAgeSeconds: 300 },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      exclude: ['node_modules', 'e2e/**', 'dist'],
    },
  };
});
