import express from 'express';
import { findBuild } from './scripts/build-paths.mjs';

export function dashboardMode(args: string[]) {
  const dev = args.includes('--dev');
  return {
    dev,
    host: dev ? '127.0.0.1' : '0.0.0.0',
  };
}

// The hub's folders where a Code update shows on the page straight away, with no restart. That is only true
// in development, where Vite reloads the page. The normal launch serves a build made when the hub starts, so
// there every applied change needs a restart: the keeper (hub-supervisor.mjs) then builds the pages again.
export function liveDashboardDirs(dev: boolean) {
  return dev ? ['src/', 'public/', 'index.html'] : [];
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
