// Website page: read and publish blog posts on the studio's Wix site through the Wix Blog REST API.
// Needs, in Account & settings: WIX_API_KEY (Wix dashboard -> Settings -> API Keys, with Blog permissions),
// WIX_SITE_ID (from the site's dashboard URL), and usually WIX_MEMBER_ID (the site member shown as the post author;
// Wix asks for it when posts are created with an API key). The key never reaches the page.
// Publishing is public: the page asks the owner to confirm, and every publish is written to Activity.
import type { Express, Request } from 'express';
import { logActivity } from './activity';

export const SITE_URL = 'https://absolutezerointera.wixsite.com/absolute-zero-intera';
const API = 'https://www.wixapis.com/blog/v3';

function isLocal(req: Request) {
  const ip = req.socket.remoteAddress || '';
  if (!(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const config = () => ({ key: process.env.WIX_API_KEY || '', site: process.env.WIX_SITE_ID || '', member: process.env.WIX_MEMBER_ID || '' });

// Plain text -> Wix rich content: one paragraph per blank-line-separated block, "# " lines become headings.
export function toRichContent(text: string) {
  const nodes = text
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block, i) => {
      const heading = block.match(/^(#{1,3})\s+(.+)$/s);
      const textNode = (t: string) => ({ type: 'TEXT', id: '', textData: { text: t, decorations: [] } });
      return heading
        ? { type: 'HEADING', id: `h${i}`, nodes: [textNode(heading[2].trim())], headingData: { level: heading[1].length + 1 } }
        : { type: 'PARAGRAPH', id: `p${i}`, nodes: [textNode(block.replace(/\r?\n/g, ' '))], paragraphData: {} };
    });
  return { nodes };
}

async function wix(path: string, init: { method?: string; body?: unknown } = {}) {
  const c = config();
  const r = await fetch(API + path, {
    method: init.method || 'GET',
    headers: { Authorization: c.key, 'wix-site-id': c.site, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Wix answered ${r.status}: ${data?.message || data?.details?.applicationError?.description || 'no details'}`);
  return data;
}

export function registerWixRoutes(app: Express) {
  app.get('/api/website', async (_req, res) => {
    const c = config();
    const ready = !!(c.key && c.site);
    if (!ready) return res.json({ site: SITE_URL, ready, needs: [!c.key && 'WIX_API_KEY', !c.site && 'WIX_SITE_ID'].filter(Boolean), posts: [] });
    try {
      const d = await wix('/posts?paging.limit=20&sort=PUBLISHED_DATE_DESC');
      const posts = (d.posts || []).map((p: any) => ({ id: p.id, title: p.title, published: p.firstPublishedDate || p.lastPublishedDate, url: p.url ? (p.url.base || '') + (p.url.path || '') : '', excerpt: p.excerpt || '' }));
      res.json({ site: SITE_URL, ready, posts });
    } catch (err: any) {
      res.json({ site: SITE_URL, ready, error: err.message, posts: [] });
    }
  });

  // Create a post; publish it only when the page sends publish: true (after the owner confirmed).
  app.post('/api/website/post', async (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Posting to the website is only allowed from the hub on this computer.' });
    const c = config();
    if (!c.key || !c.site) return res.status(400).json({ error: 'Add WIX_API_KEY and WIX_SITE_ID in Account & settings first.' });
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 200) : '';
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 20000) : '';
    const publish = req.body?.publish === true;
    if (!title || !text) return res.status(400).json({ error: 'Give the update a title and some text.' });
    try {
      const draftPost: any = { title, richContent: toRichContent(text) };
      if (c.member) draftPost.memberId = c.member;
      const d = await wix('/draft-posts', { method: 'POST', body: { draftPost, publish } });
      const id = d.draftPost?.id;
      logActivity('done', `Website: ${publish ? 'published' : 'saved a draft of'} "${title.slice(0, 80)}" on the Wix site`);
      res.json({ ok: true, id, published: publish });
    } catch (err: any) {
      logActivity('error', `Website: could not ${publish ? 'publish' : 'save'} "${title.slice(0, 60)}": ${err.message.slice(0, 160)}`);
      res.status(502).json({ error: err.message });
    }
  });
}
