import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SINGLE_FILE=1 builds one self-contained script (used for the shareable web preview)
const singleFile = !!process.env.SINGLE_FILE;

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: singleFile
    ? { outDir: 'dist-preview', rollupOptions: { output: { inlineDynamicImports: true } } }
    : {}
});
