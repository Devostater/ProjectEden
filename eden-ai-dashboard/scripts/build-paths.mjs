import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RECOVERY_BUILD = '.eden-dist-last-good';
// Saved inside every build: a fingerprint of the code it was built from (see sourceStamp).
export const BUILD_STAMP = '.eden-build.json';

export function hasBuild(directory) {
  return fs.statSync(path.join(directory, 'index.html'), { throwIfNoEntry: false })?.isFile() === true;
}

export function findBuild(root) {
  return ['dist', RECOVERY_BUILD].map(name => path.join(root, name)).find(hasBuild);
}

// What the dashboard is built from: the page code (src, public, index.html), the settings Vite reads and the
// list of packages. Pages also import a few server files, so the code files at the top of the folder and
// server/ count too. What the hub keeps for itself (.eden-*, .env*, .nexusflow-store.json) never counts.
const SOURCE_FOLDERS = ['src', 'public', 'server'];
const SOURCE_FILE = /\.(?:tsx?|mjs|js|json|html|css)$/i;

function sourceFiles(root) {
  const files = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const file = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (folder || SOURCE_FOLDERS.includes(entry.name)) walk(file);
      } else if (entry.isFile() && (folder || (!entry.name.startsWith('.') && SOURCE_FILE.test(entry.name)))) {
        files.push(file);
      }
    }
  };
  walk('');
  return files.sort();
}

// A fingerprint of the code the dashboard is built from. It changes when any of those files changes.
export function sourceStamp(root) {
  const hash = createHash('sha256');
  for (const file of sourceFiles(root)) {
    hash.update(JSON.stringify([file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  }
  return hash.digest('hex');
}

// The fingerprint a build was made from. Undefined for a build made before fingerprints were saved.
export function builtFrom(directory) {
  try {
    const { sources } = JSON.parse(fs.readFileSync(path.join(directory, BUILD_STAMP), 'utf8'));
    return typeof sources === 'string' ? sources : undefined;
  } catch {
    return undefined;
  }
}

// True when the build the hub would serve was made from the code as it is now.
export function buildIsCurrent(root, sources = sourceStamp(root)) {
  const build = findBuild(root);
  return !!build && builtFrom(build) === sources;
}
