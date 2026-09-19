import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri 开发时前端跑在固定端口，Tauri 侧通过 devUrl 连接
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // 除了 Rust 侧构建产物，还要忽略外部写入工具留下的临时目录：
      // 临时文件被锁时 chokidar 会抛 EBUSY，整个 watcher 连带 vite 一起崩。
      // 根目录的验收脚本（*.mjs）也一起忽略——它们是刚写出来就可能被锁的文件，
      // 实测能直接把 dev server 打挂。
      ignored: [
        '**/src-tauri/**',
        '**/*.tmpdir/**',
        '**/.*.tmpdir/**',
        '**/*.tmp',
        '**/*.mjs',
      ],
    },
  },
  build: {
    target: 'chrome110',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
})
