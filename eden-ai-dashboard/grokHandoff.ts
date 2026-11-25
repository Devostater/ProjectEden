import fs from 'node:fs';
import path from 'node:path';

export function saveGrokReply(folder: string, title: string, reply: string, at = new Date()): string {
  const topic = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80).replace(/^-|-$/g, '') || 'research';
  const date = [at.getFullYear(), at.getMonth() + 1, at.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
  fs.mkdirSync(folder, { recursive: true });
  for (let copy = 1; ; copy++) {
    const file = path.join(folder, `${date}-grok-${topic}${copy === 1 ? '' : `-${copy}`}.md`);
    try {
      fs.writeFileSync(file, reply, { encoding: 'utf8', flag: 'wx' });
      return file;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}
