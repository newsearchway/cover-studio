import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 部署在子路径 /cover-studio/ 下，仅生产环境生效
  base: process.env.NODE_ENV === 'production' ? '/cover-studio/' : '/',
  server: {
    port: 5180,
    host: true,
  },
})
