import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/classify': 'http://localhost:8085',
      '/detect': 'http://localhost:8085',
      '/health': 'http://localhost:8085',
      '/hardware': 'http://localhost:8085',
      '/history': 'http://localhost:8085',
      '/models': 'http://localhost:8085',
      '/model': 'http://localhost:8085',
      '/trigger': 'http://localhost:8085',
      '/metrics': 'http://localhost:8085',
      '/events': 'http://localhost:8085'
    }
  }
})
