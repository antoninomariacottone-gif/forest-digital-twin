import { defineConfig } from 'vite'

// Electron loads the production build via `file://.../dist/index.html`.
// Relative asset paths are required, otherwise `/assets/...` resolves to the filesystem root.
export default defineConfig({
  base: './',
})

