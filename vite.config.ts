import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: 1420, strictPort: true, host: '0.0.0.0' },
  build: { target: ['es2021', 'chrome90', 'safari15'] },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
});
