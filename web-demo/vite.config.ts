import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), wasm()],
  worker: {
    format: 'es',
    plugins: () => [wasm()]
  },
  server: {
    https: {
      cert: undefined,
      key: undefined
    },
    host: '0.0.0.0',
    port: 5173,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    }
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          'mediapipe': ['@mediapipe/tasks-vision'],
          'tensorflow': ['@tensorflow/tfjs', '@tensorflow/tfjs-backend-webgl']
        }
      }
    }
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision']
  }
})
