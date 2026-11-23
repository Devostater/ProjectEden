import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export function replaceFile(file: string, raw: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${randomUUID()}`;
  try {
    fs.writeFileSync(temp, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function jsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function jsonStore<T>(file: string, accepts: (value: unknown) => boolean, space?: number, recover?: (previous: T) => T) {
  const backup = `${file}.last-good`;

  function readCopy(source: string): { raw: string; value: T } | undefined {
    let raw: string;
    try {
      raw = fs.readFileSync(source, 'utf8');
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (accepts(value)) return { raw, value: value as T };

    const corrupt = `${source}.corrupt-${Date.now()}-${randomUUID()}`;
    fs.renameSync(source, corrupt);
    console.error(`[EDEN saves] Damaged JSON store ${source} preserved as ${corrupt}.`);
    return undefined;
  }

  function load() {
    const current = readCopy(file);
    const previous = readCopy(backup);
    if (current) {
      if (!previous) replaceFile(backup, current.raw);
      return current;
    }
    if (previous) {
      const recovered = recover ? recover(previous.value) : previous.value;
      const raw = recover ? JSON.stringify(recovered, null, space) : previous.raw;
      replaceFile(file, raw);
      console.warn(`[EDEN saves] Restored ${file} from ${backup}.`);
      return { raw, value: recovered };
    }

    // Recovery artifacts persist across restarts, even after a damaged store was moved aside.
    let siblings: string[];
    try {
      siblings = fs.readdirSync(path.dirname(file));
    } catch (error) {
      if (!missing(error)) throw error;
      siblings = [];
    }
    const base = path.basename(file);
    const hasHistory = siblings.some((name) => [base, `${base}.last-good`].some((prefix) =>
      name === `${prefix}.tmp` || name.startsWith(`${prefix}.tmp-`) || name.startsWith(`${prefix}.corrupt-`),
    ));
    if (hasHistory) {
      const message = `[EDEN saves] No usable copy of ${file}. Restore a verified copy at that path before continuing.`;
      console.error(message);
      throw new Error(message);
    }
    return undefined;
  }

  return {
    read: () => load()?.value,
    write(value: T) {
      const raw = JSON.stringify(value, null, space);
      if (raw === undefined || !accepts(JSON.parse(raw))) {
        throw new Error(`[EDEN saves] Refusing to write invalid data to ${file}.`);
      }
      const current = load();
      replaceFile(backup, current?.raw ?? raw);
      replaceFile(file, raw);
    },
  };
}
