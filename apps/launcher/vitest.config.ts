import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  // Mirror vite.config.ts so component tests resolve the same `@/` source alias.
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') } },
  plugins: [react()],
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
