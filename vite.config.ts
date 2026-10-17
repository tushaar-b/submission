import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('error', (_error, _request, response) => {
            if (!('writeHead' in response) || typeof response.writeHead !== 'function') return;
            response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({
              source: 'offline',
              status: 'backend_unavailable',
              error: 'Local AEROTRACE API is unavailable. Start it with `npm run server` or use `npm run dev` to start both services.',
            }));
          });
        },
      },
    },
  },
});
