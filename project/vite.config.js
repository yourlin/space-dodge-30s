import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Serving stays on loopback unless asked otherwise. A project
// on a remote dev box opts in with A3GAME_DEV_HOST=0.0.0.0,
// and allowedHosts stops Vite rejecting the forwarded Host
// header a tunnel or IDE port forward produces.
const server = {
  port: Number(process.env.A3GAME_DEV_PORT ?? 5173),
  strictPort: true,
  host: process.env.A3GAME_DEV_HOST ?? '127.0.0.1',
  allowedHosts: true,
};

export default defineConfig({
  // Relative asset URLs so the build works from any sub-path
  // (e.g. GitHub Pages at https://<user>.github.io/<repo>/).
  base: './',
  server,
  preview: server,
  resolve: {
    // One three.js instance for the game and the framework package.
    dedupe: ['three'],
    alias: {
      '@': resolve(process.cwd(), 'src'),
      '@a3game/playable': resolve(
        process.cwd(),
        'packages/a3game-playable/src/index.js',
      ),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
});
