import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // 상대 경로라 GitHub Pages 저장소 이름이 바뀌어도 그대로 동작한다.
  base: './',
  plugins: [react(), tailwindcss()],
  // music-metadata가 파서를 동적으로 불러오므로 코드 분할이 되는 형식을 쓴다.
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      output: {
        // 앱을 고쳐도 브라우저가 캐시한 라이브러리를 다시 받지 않도록 나눈다.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
