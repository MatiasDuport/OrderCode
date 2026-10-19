import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss()],
  clearScreen: false,
  cacheDir: mode === 'e2e' ? 'node_modules/.vite-e2e' : 'node_modules/.vite',
  // Monaco is already ESM and loaded on demand; prebundling its complete feature
  // registry blocks the first workspace render during a cold development start.
  optimizeDeps: { entries: ['index.html'], exclude: ['monaco-editor'] },
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
    warmup: { clientFiles: ['./src/main.tsx', './src/App.tsx', './src/styles.css', './src/workbench-theme.css'] },
  },
  build: {
    target: 'es2022',
    sourcemap: mode !== 'production',
  },
}));
