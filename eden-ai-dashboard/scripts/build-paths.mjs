import fs from 'node:fs';
import path from 'node:path';

export const RECOVERY_BUILD = '.eden-dist-last-good';

export function hasBuild(directory) {
  return fs.statSync(path.join(directory, 'index.html'), { throwIfNoEntry: false })?.isFile() === true;
}

export function findBuild(root) {
  return ['dist', RECOVERY_BUILD].map(name => path.join(root, name)).find(hasBuild);
}
