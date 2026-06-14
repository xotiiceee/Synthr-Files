import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3457',
      '/auth': 'http://localhost:3457',
      '/health': 'http://localhost:3457',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
