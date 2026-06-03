import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function cleanEmptyIsSelectors() {
  return {
    postcssPlugin: 'clean-empty-is-selectors',
    Rule(rule) {
      if (!rule.selector.includes(':is()')) return
      if (rule.selector.includes(':not(:is())')) {
        rule.selector = rule.selector.replace(/:not\(:is\(\)\)/g, '')
        return
      }
      rule.remove()
    },
  }
}
cleanEmptyIsSelectors.postcss = true

// Sentry dashboard — single-page React app
export default defineConfig({
  base: process.env.VITE_BASE_URL || '/',
  plugins: [react(), tailwindcss()],
  css: { postcss: { plugins: [cleanEmptyIsSelectors()] } },
  server: { port: 5173, strictPort: true },
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
