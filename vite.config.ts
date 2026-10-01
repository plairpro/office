import { defineConfig } from 'vite'

// base './' — чтобы сборка работала из любой подпапки GitHub Pages
export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
})
