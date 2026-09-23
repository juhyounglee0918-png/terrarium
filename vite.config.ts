/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1000 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
