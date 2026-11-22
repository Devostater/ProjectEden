import express from 'express';
import { findBuild } from './scripts/build-paths.mjs';

export function dashboardMode(args: string[]) {
  const dev = args.includes('--dev');
  return {
    dev,
    host: dev ? '127.0.0.1' : '0.0.0.0',
  };
}

export function serveDashboard(app: express.Express, root: string) {
  const build = findBuild(root);
  if (!build) throw new Error('No EDEN dashboard build found. Run npm run build and start EDEN again.');
  app.use(express.static(build, { dotfiles: 'ignore' }));
}

export function registerHealthRoute(app: express.Express, dev: boolean) {
  app.get('/health', (_req, res) => {
    res.set('Cache-Control', 'no-store')
      .set('X-Eden-Mode', dev ? 'development' : 'production')
      .json({ ok: true, pid: process.pid });
  });
}
