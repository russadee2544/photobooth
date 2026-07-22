import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        home: resolve(__dirname, 'home.html'),
        layout: resolve(__dirname, 'layout.html'),
        capture: resolve(__dirname, 'capture.html'),
        retake: resolve(__dirname, 'retake.html'),
        template: resolve(__dirname, 'template.html'),
        payment: resolve(__dirname, 'payment.html'),
        processing: resolve(__dirname, 'processing.html'),
        print: resolve(__dirname, 'print.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  }
});
