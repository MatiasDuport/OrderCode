import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss()],
  clearScreen: false,
  // Monaco is already ESM and loaded on demand; prebundling its complete feature
  // registry blocks the first workspace render during a cold development start.
  optimizeDeps: { exclude: ['monaco-editor'] },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: mode !== 'production',
  },
}));
