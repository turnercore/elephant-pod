import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return;
          }

          if (id.includes('react-icons')) {
            return 'icons';
          }

          if (id.includes('@dnd-kit')) {
            return 'drag-drop';
          }

          if (id.includes('dexie') || id.includes('fast-xml-parser')) {
            return 'data';
          }

          if (id.includes('react') || id.includes('react-dom')) {
            return 'react';
          }
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  clearScreen: false
});
