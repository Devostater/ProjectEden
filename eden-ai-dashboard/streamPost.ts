// POST a JSON body and read a streamed, line-by-line reply, with no hidden time limits.
// Node's built-in fetch stops a reply that sends nothing for 5 minutes ("terminated"). LYRA can think that long
// on a local model, so her answers were cut off. This uses plain http instead, with limits we choose:
//   idleMs  - give up if nothing at all arrives for this long
//   totalMs - give up if the whole reply takes longer than this
import http from 'node:http';
import https from 'node:https';

export interface StreamPostOptions {
  idleMs: number;
  totalMs: number;
  headers?: Record<string, string>;
}

export class StreamPostError extends Error {
  constructor(message: string, public readonly kind: 'connect' | 'status' | 'idle' | 'total' | 'closed') {
    super(message);
  }
}

export function streamPost(url: string, body: unknown, onLine: (line: string) => void, opts: StreamPostOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const data = Buffer.from(JSON.stringify(body));
    let done = false;
    let idleTimer: NodeJS.Timeout | undefined;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      if (err) {
        req.destroy();
        reject(err);
      } else resolve();
    };
    const totalTimer = setTimeout(() => finish(new StreamPostError(`no complete answer after ${Math.round(opts.totalMs / 60000)} minutes`, 'total')), opts.totalMs);
    const poke = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(new StreamPostError(`nothing heard for ${Math.round(opts.idleMs / 60000)} minutes`, 'idle')), opts.idleMs);
    };
    const req = lib.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length, ...(opts.headers || {}) } },
      (res) => {
        if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
          res.resume();
          return finish(new StreamPostError(`answered ${res.statusCode}`, 'status'));
        }
        res.setEncoding('utf8');
        let buf = '';
        poke();
        res.on('data', (chunk: string) => {
          poke();
          buf += chunk;
          let k;
          while ((k = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, k);
            buf = buf.slice(k + 1);
            try { onLine(line); } catch {}
          }
        });
        res.on('end', () => {
          if (buf) { try { onLine(buf); } catch {} }
          finish();
        });
        res.on('aborted', () => finish(new StreamPostError('the connection closed before the answer finished', 'closed')));
        res.on('error', (e) => finish(new StreamPostError(e.message, 'closed')));
      },
    );
    req.on('error', (e: any) => finish(new StreamPostError(e?.code || e?.message || String(e), 'connect')));
    req.setTimeout(0); // no socket inactivity limit of its own; ours above decides
    poke(); // also covers a server that accepts the connection and then says nothing
    req.end(data);
  });
}
