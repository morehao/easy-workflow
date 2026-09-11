import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// easy-workflow 后端（gin）默认监听 :8180，路由前缀 /process
// 见 example/main.go: StartWebApi(engine, "/process", true, "/swagger/*any", ":8180")
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_PROXY_TARGET || 'http://127.0.0.1:8180'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      open: false,
      proxy: {
        '/process': {
          target,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          // 把体积较大的第三方库拆分出来，避免单个 chunk 过大影响首屏
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            antd: ['antd', '@ant-design/icons'],
            logicflow: ['@logicflow/core', '@logicflow/extension'],
          },
        },
      },
    },
  }
})
