import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type UserConfig} from 'vite';

export default defineConfig((): UserConfig => {
  return {
    // Dashboard code does not use .env values. Keep runtime secrets out of Vite.
    envDir: false,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      host: '127.0.0.1',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      // Live reload listens on this PC only (it was open to the whole Wi-Fi on port 24678).
      hmr: process.env.DISABLE_HMR === 'true' ? false : { host: '127.0.0.1' },
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // The hub's own data and settings files change while it runs; they are not part of the page.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/.env*', '**/.nexusflow-store.json', '**/.eden-*', '**/.eden-*/**', '**/knowledge/**', '**/Deliverables/**', '**/mobile/**'] },
    },
  };
});
