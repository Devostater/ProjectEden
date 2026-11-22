import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hasBuild, RECOVERY_BUILD } from './build-paths.mjs';

const dist = path.resolve('dist');
const recovery = path.resolve(RECOVERY_BUILD);
const staging = fs.mkdtempSync(path.resolve('.eden-dist-stage-'));

try {
  // Keep the served build intact while Vite writes and validates its output.
  const build = spawnSync(process.execPath, [
    'node_modules/vite/bin/vite.js', 'build', ...process.argv.slice(2), '--outDir', staging,
  ], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  if (build.error) throw build.error;
  if (build.status !== 0 || !hasBuild(staging)) throw new Error('Vite did not produce a complete build.');

  const hadBuild = hasBuild(dist);
  if (hadBuild) {
    fs.rmSync(recovery, { recursive: true, force: true });
    fs.renameSync(dist, recovery);
  } else {
    fs.rmSync(dist, { recursive: true, force: true });
  }
  try {
    fs.renameSync(staging, dist);
  } catch (error) {
    if (hadBuild) fs.renameSync(recovery, dist);
    throw error;
  }
} catch (error) {
  console.error('EDEN build failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
