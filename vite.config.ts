
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.API_KEY': JSON.stringify(
      process.env.API_KEY || 
      process.env.GEMINI_API_KEY || 
      process.env.VITE_API_KEY || 
      process.env.VITE_GEMINI_API_KEY || 
      ''
    ),
    'process.env.GEMINI_API_KEY': JSON.stringify(
      process.env.API_KEY || 
      process.env.GEMINI_API_KEY || 
      process.env.VITE_API_KEY || 
      process.env.VITE_GEMINI_API_KEY || 
      ''
    )
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
