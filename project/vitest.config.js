import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(viteConfig, defineConfig({
  test: { include: ['packages/space-dodge/tests/**/*.spec.js'] },
}));
