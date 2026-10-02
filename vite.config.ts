import { defineConfig } from 'vite'

// base './' — чтобы сборка работала из любой подпапки GitHub Pages
export default defineConfig({
  base: './',
  // номер сборки: игроки с разными версиями видят предупреждение «обнови страницу»
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16)) },
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
})
