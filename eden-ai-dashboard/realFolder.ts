// What is unsaved in a codebase's real folder: changed files (with their content) and new files (by name,
// size and time). It is read when an update's working copy is made, and again after the AI has run if the copy
// shows no change. If the real folder changed meanwhile, the AI edited the real folder instead of its copy. That
// change was never checked or reviewed and Undo does not know about it, so the update has to say so, not
// "nothing was changed".
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { git } from './gitRun';
import { filesInDiff } from './updateOverlap';

export interface UnsavedWork {
  diff: string; // every unsaved change to files git already tracks
  untracked: string[]; // new files git does not ignore
  key: string; // the same key means nothing changed
  files: string[];
}

// root: the repository folder. rel: the codebase's folder inside it ('' when it is the whole repository).
export function unsavedWork(root: string, rel = ''): UnsavedWork {
  const where = ['--', rel || '.'];
  const diff = git(['diff', 'HEAD', '--binary', ...where], root);
  const untracked = git(['ls-files', '--others', '--exclude-standard', ...where], root).split('\n').filter(Boolean);
  const stamp = (file: string) => {
    try {
      const stat = fs.statSync(path.join(root, file));
      return `${file}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return file;
    }
  };
  return {
    diff,
    untracked,
    key: createHash('sha256').update(diff).update('\0').update(untracked.map(stamp).join('\n')).digest('hex'),
    files: [...new Set([...filesInDiff(diff), ...untracked])],
  };
}

// The files that changed in the real folder between two readings. Empty when nothing changed. Files that are
// unsaved now and were not before come first; when only already-unsaved files changed again, all are listed.
export function changedSince(before: Pick<UnsavedWork, 'key' | 'files'>, now: Pick<UnsavedWork, 'key' | 'files'>): string[] {
  if (before.key === now.key) return [];
  const fresh = now.files.filter((file) => !before.files.includes(file));
  return fresh.length ? fresh : now.files.length ? now.files : before.files;
}

export function realFolderChangedMessage(name: string, dir: string, files: string[]): string {
  const shown = files.slice(0, 6).join(', ') + (files.length > 6 ? ` and ${files.length - 6} more` : '');
  return `The AI's working copy has no change, but ${name}'s real folder changed while this update ran (${shown}). ` +
    `The AI may have edited the real folder directly. Those changes were not checked and are not in Undo: look at them in ${dir} and keep or undo them there.`;
}
