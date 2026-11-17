// One or two pages open side by side in the main area. The sidebar (and the phone bar, voice "go", the top bar)
// drive the pane you last touched; links clicked inside a page open in the OTHER pane so you keep where you were.
// Saved only while two pages are open, so a single page still starts on the Dashboard as before.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppTab } from './components/Sidebar.tsx';
import { PAGE_IDS } from './pages.tsx';

interface Layout {
  panes: AppTab[]; // 1 or 2, never the same page twice
  focus: 0 | 1;
}
const KEY = 'eden_panes';
const RATIO_KEY = 'eden_split_ratio';
const valid = (t: unknown): t is AppTab => PAGE_IDS.includes(t as AppTab);
export const clampRatio = (r: number) => Math.min(0.75, Math.max(0.25, r));

function start(): Layout {
  const wanted = new URLSearchParams(window.location.search).get('tab');
  if (valid(wanted)) return { panes: [wanted], focus: 0 };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && Array.isArray(s.panes) && s.panes.length === 2 && valid(s.panes[0]) && valid(s.panes[1]) && s.panes[0] !== s.panes[1]) return { panes: s.panes, focus: s.focus === 1 ? 1 : 0 };
  } catch {}
  return { panes: ['home'], focus: 0 };
}

export function usePanes() {
  const [layout, setLayout] = useState<Layout>(start);
  const [picking, setPicking] = useState(false); // the empty second pane shows the page picker
  const [ratio, setRatioState] = useState(() => {
    try {
      return clampRatio(Number(localStorage.getItem(RATIO_KEY)) || 0.5);
    } catch {
      return 0.5;
    }
  });
  const { panes, focus } = layout;
  const split = panes.length === 2;

  // "Go back": earlier layouts (only when the pages change, not when focus moves).
  const history = useRef<Layout[]>([]);
  const goingBack = useRef(false);
  const last = useRef<Layout>(layout);
  useEffect(() => {
    if (last.current.panes.join() !== panes.join() && !goingBack.current) history.current = [...history.current.slice(-29), last.current];
    goingBack.current = false;
    last.current = layout;
    try {
      if (split) localStorage.setItem(KEY, JSON.stringify(layout));
      else localStorage.removeItem(KEY);
    } catch {}
  }, [layout, panes, split]);

  const openBeside = useCallback((tab: AppTab) => {
    setPicking(false);
    setLayout((l) => (tab === l.panes[l.focus] ? l : { panes: [l.panes[l.focus], tab], focus: 1 }));
  }, []);

  // From the sidebar, phone bar, top bar, voice: changes the pane you're in.
  const navigate = useCallback(
    (tab: AppTab) => {
      if (picking) return openBeside(tab);
      setLayout((l) => {
        const at = l.panes.indexOf(tab);
        if (at >= 0) return at === l.focus ? l : { ...l, focus: at as 0 | 1 };
        const next = [...l.panes];
        next[l.focus] = tab;
        return { ...l, panes: next };
      });
    },
    [picking, openBeside],
  );

  // From a link inside a page: with two pages open it goes to the other pane, so the page you clicked stays.
  const reveal = useCallback(
    (tab: AppTab) => {
      if (picking) return openBeside(tab);
      setLayout((l) => {
        const at = l.panes.indexOf(tab);
        if (at >= 0) return { ...l, focus: at as 0 | 1 };
        if (l.panes.length < 2) return { panes: [tab], focus: 0 };
        const other = (1 - l.focus) as 0 | 1;
        const next = [...l.panes];
        next[other] = tab;
        return { panes: next, focus: other };
      });
    },
    [picking, openBeside],
  );

  const close = useCallback((i: 0 | 1) => setLayout((l) => (l.panes.length < 2 ? l : { panes: [l.panes[1 - i]], focus: 0 })), []);
  const setRatio = useCallback((r: number, save = true) => {
    const v = clampRatio(r);
    setRatioState(v);
    if (save)
      try {
        localStorage.setItem(RATIO_KEY, String(Math.round(v * 1000) / 1000));
      } catch {}
  }, []);
  const swap = useCallback(() => {
    setLayout((l) => (l.panes.length < 2 ? l : { panes: [l.panes[1], l.panes[0]], focus: (1 - l.focus) as 0 | 1 }));
    setRatio(1 - ratio);
  }, [ratio, setRatio]);
  const setFocus = useCallback((i: 0 | 1) => setLayout((l) => (l.focus === i || i >= l.panes.length ? l : { ...l, focus: i })), []);
  const back = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return false;
    goingBack.current = true;
    setPicking(false);
    setLayout(prev);
    return true;
  }, []);

  return {
    panes,
    focus,
    activeTab: panes[focus],
    split,
    picking,
    ratio,
    setRatio,
    navigate,
    reveal,
    openBeside,
    startPicking: () => !split && setPicking(true),
    cancelPicking: () => setPicking(false),
    close,
    swap,
    setFocus,
    back,
  };
}

export type KeepPage = 'focused' | 'left' | 'right';
const KEEP_KEY = 'eden-split-keep';
export const readKeep = (): KeepPage => {
  try { const v = localStorage.getItem(KEEP_KEY); return v === 'left' || v === 'right' ? v : 'focused'; } catch { return 'focused'; }
};
export const saveKeep = (v: KeepPage) => { try { localStorage.setItem(KEEP_KEY, v); } catch {} };
// The pane to close so the chosen page stays.
export const paneToClose = (keep: KeepPage, focus: 0 | 1): 0 | 1 => (keep === 'left' ? 1 : keep === 'right' ? 0 : ((1 - focus) as 0 | 1));
