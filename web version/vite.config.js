import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages project site: https://renanbazinin.github.io/creative-foraging-game-local/
  base: '/creative-foraging-game-local/',
  server: {
    port: 3000
  }
})
