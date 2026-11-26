import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BUILD_STAMP, hasBuild, RECOVERY_BUILD, sourceStamp } from './build-paths.mjs';

const dist = path.resolve('dist');
const recovery = path.resolve(RECOVERY_BUILD);
const staging = fs.mkdtempSync(path.resolve('.eden-dist-stage-'));

try {
  // Read before Vite starts: a file saved while it runs then makes this build count as out of date.
  const sources = sourceStamp(process.cwd());
  // Keep the served build intact while Vite writes and validates its output.
  const build = spawnSync(process.execPath, [
    'node_modules/vite/bin/vite.js', 'build', ...process.argv.slice(2), '--outDir', staging,
  ], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  if (build.error) throw build.error;
  if (build.status !== 0 || !hasBuild(staging)) throw new Error('Vite did not produce a complete build.');
  // The keeper (hub-supervisor.mjs) compares this with the code to know when to build again.
  fs.writeFileSync(path.join(staging, BUILD_STAMP), JSON.stringify({ sources, builtAt: new Date().toISOString() }));

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
