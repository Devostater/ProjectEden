import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { Express } from 'express';
import { mayManage } from './permissions.ts';
import type { Project } from './src/types/index';

const SCRIPT_PATH = '/__eden_picker.js';
const nonPublic = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) nonPublic.addSubnet(network, prefix);

function httpsTarget(raw: string): URL | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password
      && !isIP(url.hostname) && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname)
      && !/\.(?:localhost|local|internal|lan|home\.arpa)$/.test(url.hostname)) return url;
  } catch {
    return;
  }
}

export function approvedPreview(raw: string, config: string): URL | undefined {
  const target = httpsTarget(raw);
  if (target && config.split(/\s+/).some(entry => {
    const approved = httpsTarget(entry);
    return approved && approved.href === approved.origin + '/' && approved.origin === target.origin;
  })) return target;
}

export async function previewAddress(hostname: string, resolve = async (name: string) =>
  (await lookup(name, { family: 4, all: true })).map(record => record.address),
): Promise<string> {
  const addresses = await resolve(hostname);
  const local = Object.values(networkInterfaces()).flatMap(records => records ?? []).map(record => record.address);
  if (!addresses.length || addresses.some(address =>
    isIP(address) !== 4 || nonPublic.check(address) || local.includes(address))) {
    throw new Error('Preview targets must resolve to public addresses.');
  }
  return addresses[0];
}

export function previewHeaders(upstream: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const headers = { ...upstream };
  for (const name of ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'set-cookie',
    'clear-site-data', 'refresh', 'location', 'access-control-allow-credentials', 'access-control-allow-origin']) {
    delete headers[name];
  }
  // Multiple CSP policies are enforced together. Preserve every upstream policy.
  headers['content-security-policy'] = [
    ...[upstream['content-security-policy'] ?? []].flat(),
    "sandbox allow-scripts; default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'",
  ];
  headers['referrer-policy'] = [...[upstream['referrer-policy'] ?? []].flat(), 'no-referrer'].join(', ');
  headers['cache-control'] = 'no-store';
  return headers;
}

// Runs inside the previewed app. Same picking as EDEN's picker.ts, reporting to the parent window.
const PICKER_JS = `(() => {
  if (window.__edenPicker || window.parent === window) return; window.__edenPicker = true;
  let stop = null;
  const comps = (el) => { const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$')); let f = k ? el[k] : null; const n = [];
    while (f && n.length < 4) { const t = f.type; const nm = typeof t === 'function' ? t.displayName || t.name : null; if (nm && /^[A-Z]/.test(nm) && !n.includes(nm)) n.push(nm); f = f.return; } return n; };
  const describe = (el) => { const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    const where = []; for (let p = el.parentElement; p && where.length < 2; p = p.parentElement) { const nm = p.getAttribute('aria-label') || (/^(H1|H2|H3)$/.test(p.tagName) ? p.textContent : ''); if (nm) where.push(nm.trim().slice(0, 40)); }
    return Object.assign({ label: t.slice(0, 80) || '(' + el.tagName.toLowerCase() + ')', tag: el.tagName.toLowerCase(), components: comps(el), where: where.join(' â€º '), classes: (typeof el.className === 'string' ? el.className : '').split(/\\s+/).filter(Boolean).slice(0, 6).join(' '), page: location.pathname }, detail(el)); };
  // Same extra detail as detail() in src/picker.ts: id, path in the page, its HTML, styles on screen, neighbours.
  const KEYS = ['display', 'position', 'width', 'height', 'padding', 'margin', 'color', 'background-color', 'font-size', 'font-weight', 'border-radius', 'border', 'opacity', 'cursor', 'pointer-events'];
  const short = (el) => { const cls = typeof el.className === 'string' ? el.className.split(/\\s+/).filter(Boolean).slice(0, 2).map((c) => '.' + c).join('') : ''; return el.tagName.toLowerCase() + (el.id ? '#' + el.id : cls); };
  const detail = (el) => {
    const parts = []; for (let p = el; p && p.tagName !== 'BODY' && p.tagName !== 'HTML' && parts.length < 5; p = p.parentElement) parts.unshift(short(p));
    const open = el.outerHTML.slice(0, el.outerHTML.indexOf('>') + 1), inner = (el.innerText || '').replace(/\\s+/g, ' ').trim();
    const html = el.children.length > 0 || el.outerHTML.length > 400 ? open.slice(0, 300) + (inner ? inner.slice(0, 80) + 'â€¦' : 'â€¦') + '</' + el.tagName.toLowerCase() + '>' : el.outerHTML;
    const cs = getComputedStyle(el);
    const styles = KEYS.map((k) => [k, cs.getPropertyValue(k)]).filter((x) => x[1] && x[1] !== 'none' && x[1] !== 'normal' && x[1] !== 'auto' && x[1] !== '0px').map((x) => x[0] + ': ' + x[1]).join('; ');
    const siblings = el.parentElement ? Array.from(el.parentElement.children).filter((s) => s !== el).slice(0, 4).map(short) : [];
    return { elId: el.id || undefined, path: parts.join(' > '), html, styles, siblings };
  };
  const start = () => { if (stop) return;
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #6366f1;background:rgba(99,102,241,.12);border-radius:4px;display:none'; document.body.appendChild(box);
    const move = (e) => { const r = e.target.getBoundingClientRect(); Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }); };
    const press = (e) => { e.preventDefault(); e.stopPropagation(); parent.postMessage({ type: 'eden-pick', pick: describe(e.target) }, '*'); };
    const block = (e) => { e.preventDefault(); e.stopPropagation(); };
    const key = (e) => { if (e.key === 'Escape') { end(); parent.postMessage({ type: 'eden-pick-ended' }, '*'); } };
    const ev = [['mousemove', move], ['pointerdown', press], ['click', block], ['mousedown', block], ['mouseup', block], ['keydown', key]];
    ev.forEach(([n, f]) => document.addEventListener(n, f, true));
    const end = () => { ev.forEach(([n, f]) => document.removeEventListener(n, f, true)); box.remove(); stop = null; };
    stop = end; };
  addEventListener('message', (e) => { if (e.source !== parent) return; if (e.data && e.data.type === 'eden-pick-start') start(); if (e.data && e.data.type === 'eden-pick-stop' && stop) stop(); });
  parent.postMessage({ type: 'eden-preview-ready' }, '*');
})();`;

type PreviewRequest = (
  options: https.RequestOptions, callback: (response: http.IncomingMessage) => void,
) => http.ClientRequest;

function startProxy(
  target: URL, resolveAddress: typeof previewAddress, dispatch: PreviewRequest,
): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    const reject = (status: number, message: string) => {
      res.writeHead(status, { ...previewHeaders({}), 'content-type': 'text/plain' });
      res.end(message);
    };
    const address = server.address();
    if (typeof address !== 'object' || !address || req.headers.host !== `127.0.0.1:${address.port}`) {
      return reject(403, 'Invalid preview host.');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return reject(405, 'Only reads are allowed.');
    const requestPath = req.url ?? '/';
    if (!requestPath.startsWith('/') || /^\/[\/\\]/.test(requestPath)) return reject(400, 'Invalid preview path.');
    if (requestPath === SCRIPT_PATH) {
      res.writeHead(200, { ...previewHeaders({}), 'content-type': 'text/javascript' });
      return res.end(PICKER_JS);
    }

    try {
      const ip = await resolveAddress(target.hostname);
      if (res.destroyed) return;
      // Connect to the checked address. TLS still verifies the approved hostname.
      const upstream = dispatch({
        hostname: ip, servername: target.hostname, method: req.method, path: requestPath,
        headers: { host: target.host, 'accept-encoding': 'identity' }, agent: false,
      }, response => {
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          response.destroy();
          return reject(502, 'Preview redirects are blocked.');
        }
        const headers = previewHeaders(response.headers);
        response.on('error', () => res.destroy());
        const html = status === 200 && req.method === 'GET' && !headers['content-encoding']
          && /^text\/html(?:\s*;|$)/i.test(String(headers['content-type']));
        if (!html) {
          res.writeHead(status, headers);
          response.pipe(res);
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= 4 * 1024 * 1024) chunks.push(chunk);
          else {
            reject(502, 'Preview page is too large.');
            response.destroy();
          }
        });
        response.on('end', () => {
          const page = Buffer.concat(chunks).toString('utf8');
          const tag = `<script src="${SCRIPT_PATH}"></script>`;
          delete headers['content-length'];
          delete headers.etag;
          res.writeHead(status, headers);
          res.end(/<\/body>/i.test(page) ? page.replace(/<\/body>/i, tag + '</body>') : page + tag);
        });
      });
      upstream.setTimeout(10000, () => upstream.destroy());
      res.on('close', () => upstream.destroy());
      upstream.on('error', () => {
        if (res.destroyed || res.writableEnded) return;
        if (res.headersSent) res.destroy();
        else reject(502, 'The approved preview app is unavailable.');
      });
      upstream.end();
    } catch {
      reject(502, 'The approved preview app has no usable public address.');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.unref()));
  });
}

export function registerPreviewProxy(app: Express, getStore: () => { projects?: Pick<Project, 'id' | 'previewUrl'>[] },
  config = process.env.EDEN_PREVIEW_ORIGINS ?? '',
  resolveAddress = previewAddress, dispatch: PreviewRequest = https.request,
) {
  const proxies = new Map<string, Promise<http.Server>>();
  app.post('/api/projects/:id/live', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!mayManage(req)) return res.status(403).json({ error: 'Open previews from EDEN on the owner PC.' });
    if (!config.trim()) return res.status(403).json({ error: 'Project app previews are disabled on this hub.' });
    const project = getStore().projects?.find(p => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    if (!project.previewUrl) return res.json({ url: null });
    const target = approvedPreview(project.previewUrl, config);
    if (!target) return res.status(403).json({ error: 'This public HTTPS preview origin has not been approved on the owner PC.' });
    try {
      let proxy = proxies.get(target.origin);
      if (!proxy) {
        proxy = startProxy(target, resolveAddress, dispatch);
        proxies.set(target.origin, proxy);
      }
      const address = (await proxy).address();
      if (!address || typeof address === 'string') throw new Error('Preview listener unavailable.');
      // Assign the pathname separately from the loopback origin.
      const url = new URL(`http://127.0.0.1:${address.port}`);
      url.pathname = target.pathname;
      url.search = target.search;
      res.json({ url: url.href });
    } catch {
      proxies.delete(target.origin);
      res.status(502).json({ error: 'Could not open the approved preview.' });
    }
  });
  return async () => {
    const pending = [...proxies.values()];
    proxies.clear();
    await Promise.allSettled(pending.map(async proxy => {
      const server = await proxy;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }));
  };
}
