import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { copyFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(), 
    wasm(),
    // basicSsl(), // 暂时禁用 HTTPS，避免证书问题导致 MediaPipe 加载失败
    // 自定义插件：复制 MediaPipe WASM 文件
    {
      name: 'copy-mediapipe-assets',
      generateBundle() {
        try {
          // 确保目标目录存在
          const wasmDir = resolve(__dirname, 'dist/node_modules/@mediapipe/tasks-vision/wasm');
          mkdirSync(wasmDir, { recursive: true });
          
          // 复制 WASM 文件
          const sourceDir = resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm');
          const files = ['vision_wasm_internal.wasm', 'vision_wasm_internal.js'];
          
          files.forEach(file => {
            try {
              copyFileSync(
                resolve(sourceDir, file),
                resolve(wasmDir, file)
              );
              console.log(`✅ Copied ${file} to dist`);
            } catch (e) {
              console.warn(`⚠️ Could not copy ${file}:`, e instanceof Error ? e.message : String(e));
            }
          });
        } catch (e) {
          console.warn('⚠️ MediaPipe WASM copy failed:', e instanceof Error ? e.message : String(e));
        }
      }
    }
  ],
  worker: {
    format: 'es',
    plugins: () => [wasm()]
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    },
    fs: {
      allow: ['..']
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
    },
    // Vercel optimization
    sourcemap: false,
    minify: 'terser'
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision']
  }
})
