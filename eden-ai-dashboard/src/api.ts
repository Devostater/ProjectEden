// One way to call the hub's server, with errors a person can act on.
//   - The hub isn't running            -> "Can't reach the hub…"
//   - The page is newer than the server -> "…restart the hub…" (and a banner appears, see App)
//   - Anything else                     -> the server's own message
export const OUTDATED_EVENT = 'eden-server-outdated';

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the hub. Check that Start Eden is running on your computer, then try again.");
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data: any = isJson ? await res.json().catch(() => ({})) : {};
  if (res.ok) return data as T;
  if (data.error) throw new Error(data.error);
  // A route the server doesn't know: the page was updated but the server is still the old one.
  if (res.status === 404 && !isJson) {
    window.dispatchEvent(new Event(OUTDATED_EVENT));
    throw new Error('The hub was updated but is still running the old version. Restart it (close and reopen Start Eden), then try again.');
  }
  throw new Error(`The hub couldn't do that (error ${res.status}). Try again, or restart the hub if it keeps happening.`);
}
