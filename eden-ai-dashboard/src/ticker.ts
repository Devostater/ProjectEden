import { useSyncExternalStore } from 'react';

// The news ticker's lines. The Dashboard works them out and hands them over here; the status bar at the top shows them.
// null means the ticker is switched off (or the Dashboard has not run yet).
let items: string[] | null = null;
const listeners = new Set<() => void>();

export const setTickerItems = (next: string[] | null) => {
  const same = next === items || (!!next && !!items && next.length === items.length && next.every((t, i) => t === items![i]));
  if (same) return;
  items = next;
  listeners.forEach((l) => l());
};

export const useTickerItems = (): string[] | null =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
  );
