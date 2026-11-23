import os from 'node:os';
﻿import type { Request } from 'express';

const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[[0-9a-f:.]+\]$/i.test(h);
// Same rule as HUNTER's, for a PC without HUNTER.
export const hostOkLocal = (hostHeader?: string) => {
  if (!hostHeader) return true;
  const h = hostHeader.toLowerCase().replace(/:\d+$/, '');
  return h === 'localhost' || isIp(h) || h === os.hostname().toLowerCase() || /\.(ts\.net|local|lan|home)$/.test(h);
};

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isForeignApiRequest(req: Request): boolean {
  if (!req.path.startsWith('/api/')) return false;
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  const writes = WRITES.has(req.method);
  if (site === 'cross-site' || (site === 'same-site' && writes)) return true;
  const origin = req.headers.origin;
  if (!origin || !writes) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

export const isLocal = (req: Request) => {
  const ip = req.socket.remoteAddress;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
};

export const fromOwnPage = (req: Request) => {
  try {
    const expectedOrigin = new URL(`${req.protocol}://${req.headers.host}`).origin;
    return req.headers.origin === expectedOrigin && !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'] ?? '');
  } catch {
    return false;
  }
};

// LYRA routes using this policy historically compare only the host, including its port.
export function mayUseLyraFromOwnHost(req: Request): boolean {
  if (!isLocal(req)) return false;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export const mayView = isLocal;
export const mayManage = (req: Request) => isLocal(req) && fromOwnPage(req);

// Keep these paths exact. New APIs and files need an explicit decision before paired access.
const tabletPages = new Set([
  '/', '/index.html', '/api/me', '/manifest.webmanifest', '/sw.js', '/offline.html',
  '/apple-touch-icon.png', '/favicon-32.png', '/icon-192.png', '/icon-512.png',
  '/icon-maskable-512.png', '/icon.svg',
]);

export function mayUseTabletRoute(req: Request): boolean {
  if (req.method === 'POST') return req.path === '/api/tablet/chat' && fromOwnPage(req);
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  return tabletPages.has(req.path) || /^\/assets\/[\w.-]+\.(?:js|css)$/.test(req.path);
}

function webhookDestination(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.hash) return url.href;
  } catch {
    return;
  }
}

export async function sendApprovedWebhook(
  destination: unknown, headers: Record<string, string>, body: string,
  config = process.env.EDEN_WEBHOOK_DESTINATIONS, dispatch = fetch,
): Promise<number> {
  if (!config?.trim()) throw new Error('Pipeline webhooks are disabled.');
  const target = webhookDestination(destination);
  if (!target || !config.split(/\s+/).some((approved) => webhookDestination(approved) === target)) {
    throw new Error('This webhook destination has not been approved on the owner PC.');
  }

  let response: Response;
  try {
    response = await dispatch(target, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error('Webhook request failed.');
  }
  await response.body?.cancel().catch(() => {});
  if (response.status >= 300 && response.status < 400) throw new Error('Webhook redirects are blocked.');
  if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}.`);
  return response.status;
}
