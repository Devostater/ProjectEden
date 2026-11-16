// Run with: npm run test:updates (runs every test/*.test.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { streamPost, StreamPostError } from '../streamPost.ts';

// A tiny server that answers like LYRA: lines of JSON, with pauses in between.
function server(handler: (res: http.ServerResponse) => void) {
  const s = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      handler(res);
    });
  });
  return new Promise<{ url: string; close: () => void }>((ok) => s.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/chat`, close: () => s.close() })));
}

test('a reply with a long quiet stretch (longer than the old limit would allow, scaled down) still arrives', async () => {
  const srv = await server((res) => {
    res.write('{"type":"route","model":"qwen"}\n');
    setTimeout(() => { res.write('{"type":"answer","text":"done"}\n'); res.end(); }, 400); // quiet for 400 ms
  });
  const lines: string[] = [];
  try {
    await streamPost(srv.url, { hi: 1 }, (l) => lines.push(l), { idleMs: 1000, totalMs: 5000 });
  } finally {
    srv.close();
  }
  assert.deepEqual(lines, ['{"type":"route","model":"qwen"}', '{"type":"answer","text":"done"}']);
});

test('gives up with kind "idle" when nothing arrives for idleMs', async () => {
  const srv = await server((res) => { res.write('{"type":"route"}\n'); /* then silence */ });
  try {
    await assert.rejects(streamPost(srv.url, {}, () => {}, { idleMs: 200, totalMs: 5000 }), (e: any) => e instanceof StreamPostError && e.kind === 'idle');
  } finally {
    srv.close();
  }
});

test('gives up with kind "total" when the whole reply takes too long, even if lines keep coming', async () => {
  const srv = await server((res) => { const t = setInterval(() => res.write('{"type":"thinking"}\n'), 50); res.on('close', () => clearInterval(t)); });
  try {
    await assert.rejects(streamPost(srv.url, {}, () => {}, { idleMs: 1000, totalMs: 300 }), (e: any) => e instanceof StreamPostError && e.kind === 'total');
  } finally {
    srv.close();
  }
});

test('connection refused is reported as kind "connect"', async () => {
  await assert.rejects(streamPost('http://127.0.0.1:1/api/chat', {}, () => {}, { idleMs: 1000, totalMs: 2000 }), (e: any) => e instanceof StreamPostError && e.kind === 'connect');
});

test('a non-2xx answer is reported as kind "status"', async () => {
  const s = http.createServer((req, res) => { req.resume(); res.writeHead(500); res.end('nope'); });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/x`;
  try {
    await assert.rejects(streamPost(url, {}, () => {}, { idleMs: 1000, totalMs: 2000 }), (e: any) => e instanceof StreamPostError && e.kind === 'status');
  } finally {
    s.close();
  }
});
