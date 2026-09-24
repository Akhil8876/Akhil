import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The fitting maths, sizing, smoothing and keypoint definitions are
      // shared verbatim with the React Native app. They have no platform
      // imports, so the browser build uses the same source of truth.
      '@shared': path.resolve(repoRoot, 'src'),
    },
  },
  server: {
    // Allow Vite to serve the shared modules from outside web/.
    fs: { allow: [repoRoot] },
    host: true,
  },
});
