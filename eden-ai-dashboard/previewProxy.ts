// Live app preview: shows a project's running app (its dev server, e.g. http://localhost:5173) inside EDEN, with
// EDEN's element picker working in it. Each project gets a small proxy on its own port (3101, 3102, ...) that
// passes everything through to the app and adds one script to its pages. The script talks to EDEN with
// postMessage: EDEN says "start picking", the page sends back each picked element. Only addresses on this computer
// are allowed, and the proxy only listens on this computer.
import http from 'http';
import net from 'net';
import type { Express, Request } from 'express';
import type { Project } from './src/types/index';

const SCRIPT_PATH = '/__eden_picker.js';
const proxies = new Map<string, { target: string; port: number; server: http.Server }>();

export function localTarget(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

// Runs inside the previewed app. Same picking as EDEN's picker.ts, reporting to the parent window.
const PICKER_JS = `(() => {
  if (window.__edenPicker || window.parent === window) return; window.__edenPicker = true;
  let stop = null;
  const comps = (el) => { const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$')); let f = k ? el[k] : null; const n = [];
    while (f && n.length < 4) { const t = f.type; const nm = typeof t === 'function' ? t.displayName || t.name : null; if (nm && /^[A-Z]/.test(nm) && !n.includes(nm)) n.push(nm); f = f.return; } return n; };
  const describe = (el) => { const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    const where = []; for (let p = el.parentElement; p && where.length < 2; p = p.parentElement) { const nm = p.getAttribute('aria-label') || (/^(H1|H2|H3)$/.test(p.tagName) ? p.textContent : ''); if (nm) where.push(nm.trim().slice(0, 40)); }
    return Object.assign({ label: t.slice(0, 80) || '(' + el.tagName.toLowerCase() + ')', tag: el.tagName.toLowerCase(), components: comps(el), where: where.join(' › '), classes: (typeof el.className === 'string' ? el.className : '').split(/\\s+/).filter(Boolean).slice(0, 6).join(' '), page: location.pathname }, detail(el)); };
  // Same extra detail as detail() in src/picker.ts: id, path in the page, its HTML, styles on screen, neighbours.
  const KEYS = ['display', 'position', 'width', 'height', 'padding', 'margin', 'color', 'background-color', 'font-size', 'font-weight', 'border-radius', 'border', 'opacity', 'cursor', 'pointer-events'];
  const short = (el) => { const cls = typeof el.className === 'string' ? el.className.split(/\\s+/).filter(Boolean).slice(0, 2).map((c) => '.' + c).join('') : ''; return el.tagName.toLowerCase() + (el.id ? '#' + el.id : cls); };
  const detail = (el) => {
    const parts = []; for (let p = el; p && p.tagName !== 'BODY' && p.tagName !== 'HTML' && parts.length < 5; p = p.parentElement) parts.unshift(short(p));
    const open = el.outerHTML.slice(0, el.outerHTML.indexOf('>') + 1), inner = (el.innerText || '').replace(/\\s+/g, ' ').trim();
    const html = el.children.length > 0 || el.outerHTML.length > 400 ? open.slice(0, 300) + (inner ? inner.slice(0, 80) + '…' : '…') + '</' + el.tagName.toLowerCase() + '>' : el.outerHTML;
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

function startProxy(projectId: string, target: URL): Promise<number> {
  const existing = proxies.get(projectId);
  if (existing && existing.target === target.origin) return Promise.resolve(existing.port);
  if (existing) existing.server.close();
  const server = http.createServer((req, res) => {
    if (req.url === SCRIPT_PATH) {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return res.end(PICKER_JS);
    }
    const headers = { ...req.headers, host: target.host };
    delete headers['accept-encoding']; // plain responses, so the script can be added to HTML
    const up = http.request({ host: target.hostname.replace(/^\[|\]$/g, ''), port: target.port || 80, method: req.method, path: req.url, headers }, (r) => {
      const type = String(r.headers['content-type'] || '');
      if (!type.includes('text/html')) {
        res.writeHead(r.statusCode || 200, r.headers);
        return r.pipe(res);
      }
      const chunks: Buffer[] = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8');
        const tag = `<script src="${SCRIPT_PATH}"></script>`;
        html = html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : html + tag;
        const h = { ...r.headers };
        delete h['content-length'];
        delete h['content-security-policy'];
        delete h['x-frame-options'];
        res.writeHead(r.statusCode || 200, h);
        res.end(html);
      });
    });
    up.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end(`<p style="font:14px system-ui;padding:24px">The app at ${target.origin} isn't answering. Start it (for example its dev server), then press Reload in EDEN.</p>`);
    });
    req.pipe(up);
  });
  // Live reload (websockets) passes straight through.
  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(Number(target.port || 80), target.hostname.replace(/^\[|\]$/g, ''), () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries({ ...req.headers, host: target.host }).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
      if (head?.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      server.once('error', (e: any) => (e.code === 'EADDRINUSE' && port < 3199 ? tryPort(port + 1) : reject(e)));
      server.listen(port, '127.0.0.1', () => {
        proxies.set(projectId, { target: target.origin, port, server });
        resolve(port);
      });
    };
    tryPort(3101);
  });
}

export function registerPreviewProxy(app: Express, getStore: () => { projects?: Project[] }) {
  app.get('/api/projects/:id/live', async (req: Request, res) => {
    const project = (getStore().projects || []).find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    if (!project.previewUrl) return res.json({ url: null });
    const target = localTarget(project.previewUrl);
    if (!target) return res.status(400).json({ error: 'The live app address must be on this computer, like http://localhost:5173.' });
    try {
      const port = await startProxy(project.id, target);
      res.json({ url: `http://${req.hostname === 'localhost' || req.hostname === '127.0.0.1' ? req.hostname : 'localhost'}:${port}${target.pathname}${target.search}`, target: project.previewUrl });
    } catch (err: any) {
      res.status(500).json({ error: `Could not start the preview: ${err.message}` });
    }
  });
}
