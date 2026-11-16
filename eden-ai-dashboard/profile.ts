// Your profile on this hub: picture, frame, a short bio, your links and your own quick commands.
// Kept in .eden-profile.json on this computer (git-ignored). Only pages served by this hub can change it.
import fs from 'fs';
import path from 'path';
import type { Express, Request } from 'express';

const FILE = path.join(process.cwd(), '.eden-profile.json');

export interface Profile {
  avatar: string; // a data: URL of a small picture, or ''
  frame: string; // frame id (see src/components/Avatar.tsx)
  bio: string;
  links: { label: string; url: string }[];
  commands: { label: string; text: string }[];
}
const EMPTY: Profile = { avatar: '', frame: 'none', bio: '', links: [], commands: [] };

function load(): Profile {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...EMPTY };
  }
}

// From this computer, and not from another website open in a browser here.
function isLocal(req: Request) {
  const ip = req.socket.remoteAddress || '';
  if (!(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function registerProfileRoutes(app: Express) {
  app.get('/api/profile', (_req, res) => res.json(load()));

  app.post('/api/profile', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Your profile can only be changed on this computer.' });
    const b = req.body || {};
    const avatar = typeof b.avatar === 'string' ? b.avatar : '';
    if (avatar && !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(avatar)) return res.status(400).json({ error: 'The picture must be a PNG, JPG, WebP or GIF.' });
    if (avatar.length > 600_000) return res.status(400).json({ error: 'That picture is too big. Pick one under about 400 KB.' });
    const links = (Array.isArray(b.links) ? b.links : [])
      .map((l: any) => ({ label: str(l?.label, 40), url: str(l?.url, 500) }))
      .filter((l: { label: string; url: string }) => l.label && /^https?:\/\//i.test(l.url))
      .slice(0, 12);
    const commands = (Array.isArray(b.commands) ? b.commands : [])
      .map((c: any) => ({ label: str(c?.label, 40), text: str(c?.text, 2000) }))
      .filter((c: { label: string; text: string }) => c.label && c.text)
      .slice(0, 12);
    const profile: Profile = { avatar, frame: str(b.frame, 30) || 'none', bio: str(b.bio, 300), links, commands };
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(profile, null, 2));
    fs.renameSync(tmp, FILE);
    res.json(profile);
  });
}
