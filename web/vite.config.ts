import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // [2026-09-28] contracts/protection-tips.json liegt ausserhalb von web/
  // (gemeinsame Quelle mit iOS) -- der Dev-Server muss den Repo-Ordner lesen.
  server: { fs: { allow: ['..'] } },
})
