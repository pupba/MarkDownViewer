import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml: html => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/i, ''),
    },
  ],
  test: { include: ['tests/**/*.test.{ts,tsx}'], environment: 'jsdom' },
});
