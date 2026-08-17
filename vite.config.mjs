import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-next',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app.html'),
        home: resolve(import.meta.dirname, 'home.html'),
        layout: resolve(import.meta.dirname, 'layout.html'),
        capture: resolve(import.meta.dirname, 'capture.html'),
        retake: resolve(import.meta.dirname, 'retake.html'),
        template: resolve(import.meta.dirname, 'template.html'),
        payment: resolve(import.meta.dirname, 'payment.html'),
        filter: resolve(import.meta.dirname, 'filter.html'),
        processing: resolve(import.meta.dirname, 'processing.html'),
        print: resolve(import.meta.dirname, 'print.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
        templateEditor: resolve(import.meta.dirname, 'template-editor.html'),
      },
    },
  },
});
