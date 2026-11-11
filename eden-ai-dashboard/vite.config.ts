import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // The hub's own data and settings files change while it runs; they are not part of the page.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/.env*', '**/.nexusflow-store.json', '**/.eden-usage.json', '**/.eden-pairing.json', '**/.eden-control.json', '**/.eden-updates.json', '**/.eden-codebases.json', '**/.eden-devices.json', '**/.eden-ai.json', '**/.eden-main.json', '**/.eden-ideas.json', '**/.eden-logs/**', '**/.eden-aura-mcp.json', '**/.eden-busy.json', '**/.eden-offline.json', '**/mobile/**'] },
    },
  };
});
