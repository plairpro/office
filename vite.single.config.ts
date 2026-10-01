import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Сборка в один HTML-файл: открывается двойным кликом, без сервера
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', outDir: 'dist-single', chunkSizeWarningLimit: 2000 },
})
