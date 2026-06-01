import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// RescueGrid dashboard — single-page React app
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Keep the heavy Sui/zkLogin SDK out of the app's critical chunk.
        manualChunks(id) {
          if (id.includes('node_modules/@mysten') || id.includes('node_modules/@tanstack')) return 'sui'
        },
      },
    },
  },
})
