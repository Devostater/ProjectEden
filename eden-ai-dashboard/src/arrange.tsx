// Re-arrangeable lists (the left bar's pages, the bottom bar's tabs). The order is saved per device. In "Arrange"
// mode each item gets big Up/Down buttons (easier than dragging) and can also be dragged onto another item.
// Items are placed with CSS `order`, so nothing remounts and lists keep their open/closed state.
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, GripVertical, Eye, EyeOff, X } from 'lucide-react';

const EVENT = 'eden-arrange';

function read(key: string, ids: string[]): string[] {
  let saved: string[] = [];
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(v)) saved = v.filter((x) => typeof x === 'string');
  } catch {}
  // Saved order first (only ids that still exist), then anything new in its default place at the end.
  const known = saved.filter((id) => ids.includes(id));
  return [...known, ...ids.filter((id) => !known.includes(id))];
}

export function useArrangedOrder(key: string, ids: string[]) {
  const idsKey = ids.join('|');
  const [order, setOrder] = useState<string[]>(() => read(key, ids));
  useEffect(() => {
    const sync = () => setOrder(read(key, ids));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, idsKey]);
  const save = useCallback(
    (next: string[]) => {
      setOrder(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  // Swap with the nearest neighbour that is showing (hidden items, e.g. project tabs off the Projects page, are skipped).
  const neighbour = useCallback(
    (id: string, delta: number, showing?: string[]) => {
      let j = order.indexOf(id) + delta;
      while (j >= 0 && j < order.length && showing && !showing.includes(order[j])) j += delta;
      return j >= 0 && j < order.length ? j : -1;
    },
    [order],
  );
  const move = useCallback(
    (id: string, delta: number, showing?: string[]) => {
      const i = order.indexOf(id);
      const j = neighbour(id, delta, showing);
      if (i < 0 || j < 0) return;
      const next = [...order];
      [next[i], next[j]] = [next[j], next[i]];
      save(next);
    },
    [order, save, neighbour],
  );
  const moveTo = useCallback(
    (id: string, target: string) => {
      if (id === target) return;
      const next = order.filter((x) => x !== id);
      next.splice(next.indexOf(target), 0, id);
      save(next);
    },
    [order, save],
  );
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {}
    setOrder([...ids]);
    window.dispatchEvent(new Event(EVENT));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, idsKey]);
  const pos = useCallback((id: string) => Math.max(0, order.indexOf(id)), [order]);
  return { order, pos, move, moveTo, reset, neighbour };
}

// One item of an arranged list. Outside Arrange mode it only sets the item's place; in Arrange mode it adds the
// move buttons and lets you drag it onto another item.
export const Arrangeable: React.FC<{
  id: string;
  label: string;
  arr: ReturnType<typeof useArrangedOrder>;
  arranging: boolean;
  horizontal?: boolean;
  showing?: string[]; // the items currently shown, so the arrows skip hidden ones

  className?: string;
  hidden?: boolean; // hidden by you: not shown outside Arrange mode
  onToggleHidden?: () => void; // shows a Show/Hide eye while arranging
  onRemove?: () => void; // shows a Remove (X) while arranging, for tabs you added
  children: React.ReactNode;
}> = ({ id, label, arr, arranging, horizontal = false, showing, className = '', hidden = false, onToggleHidden, onRemove, children }) => {
  const i = arr.pos(id);
  const canPrev = arr.neighbour(id, -1, showing) >= 0;
  const canNext = arr.neighbour(id, 1, showing) >= 0;
  const btn = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 hover:border-indigo-500 disabled:opacity-30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
  if (hidden && !arranging) return null;
  const Prev = horizontal ? ArrowLeft : ArrowUp;
  const Next = horizontal ? ArrowRight : ArrowDown;
  return (
    <div
      style={{ order: i }}
      className={`${arranging ? "" : className} ${arranging ? `flex flex-row items-center gap-0.5 rounded-lg ring-2 ring-dashed ring-indigo-400/60 ${horizontal ? 'px-1' : 'p-1'}` : ''}`}
      draggable={arranging}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-eden-arrange', id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (arranging && e.dataTransfer.types.includes('text/x-eden-arrange')) e.preventDefault();
      }}
      onDrop={(e) => {
        const from = e.dataTransfer.getData('text/x-eden-arrange');
        if (from) {
          e.preventDefault();
          arr.moveTo(from, id);
        }
      }}
    >
      {arranging && <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-500" aria-hidden />}
      <div className={arranging ? `pointer-events-none min-w-0 flex-1 ${hidden ? 'opacity-40' : ''}` : 'contents'}>{children}</div>
      {arranging && (
        <>
          <button type="button" onClick={() => arr.move(id, -1, showing)} disabled={!canPrev} aria-label={`Move ${label} ${horizontal ? 'left' : 'up'}`} title={`Move ${horizontal ? 'left' : 'up'}`} className={btn}>
            <Prev className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => arr.move(id, 1, showing)} disabled={!canNext} aria-label={`Move ${label} ${horizontal ? 'right' : 'down'}`} title={`Move ${horizontal ? 'right' : 'down'}`} className={btn}>
            <Next className="h-4 w-4" />
          </button>
          {onToggleHidden && (
            <button type="button" onClick={onToggleHidden} aria-pressed={!hidden} aria-label={hidden ? `Show ${label}` : `Hide ${label}`} title={hidden ? 'Hidden: press to show' : 'Press to hide'} className={btn}>
              {hidden ? <EyeOff className="h-4 w-4 text-red-500" /> : <Eye className="h-4 w-4 text-emerald-500" />}
            </button>
          )}
          {onRemove && (
            <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} title="Remove this tab" className={`${btn} hover:border-red-500 hover:text-red-600`}>
              <X className="h-4 w-4" />
            </button>
          )}
        </>
      )}
    </div>
  );
};
