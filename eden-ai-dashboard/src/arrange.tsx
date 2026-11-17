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
  // Used by hold-and-drag: drop on a neighbour and take its place (after it when moving right/down, before it when moving left/up).
  const moveNear = useCallback(
    (id: string, target: string) => {
      const from = order.indexOf(id);
      const to = order.indexOf(target);
      if (id === target || from < 0 || to < 0) return;
      const next = order.filter((x) => x !== id);
      next.splice(next.indexOf(target) + (from < to ? 1 : 0), 0, id);
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
  return { order, pos, move, moveTo, moveNear, reset, neighbour, listKey: key };
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
  holdDrag?: string; // a list name: outside Arrange mode, press and hold an item, then drag it to a new place in that list
  children: React.ReactNode;
}> = ({ id, label, arr, arranging, horizontal = false, showing, className = '', hidden = false, onToggleHidden, onRemove, holdDrag: holdDragProp, children }) => {
  const [lifted, setLifted] = useState(false);
  // Every arranged list (side bar, bottom bar, ...) can be re-ordered by a short press-and-drag.
  const holdDrag = holdDragProp ?? arr.listKey;
  const i = arr.pos(id);
  // Press and hold (about a third of a second), then drag onto another item of the same list and let go.
  const startHold = (e: React.PointerEvent) => {
    if (!holdDrag || arranging || e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let isLifted = false;
    let moved = false; // dragged after lifting; a hold that is let go in place is still a normal click
    let target: HTMLElement | null = null;
    const mark = (el: HTMLElement | null) => {
      if (target === el) return;
      if (target) target.style.outline = '';
      target = el;
      if (target) target.style.outline = '2px solid rgb(99 102 241)';
    };
    const timer = window.setTimeout(() => {
      // Ready to drag, but nothing changes on screen until the pointer actually moves: growing the item now would
      // shift what is under a still pointer and send a slow click to the wrong button.
      isLifted = true;
    }, 300);
    const move = (ev: PointerEvent) => {
      if (!isLifted) {
        // Moved before the hold finished: this is a normal press or scroll, not a drag.
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) finish(false);
        return;
      }
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
        moved = true;
        setLifted(true);
      }
      if (!moved) return;
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>(`[data-arrange-list="${holdDrag}"]`) ?? null;
      mark(under && under.dataset.arrangeId !== id ? under : null);
    };
    const finish = (drop: boolean) => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      const to = target?.dataset.arrangeId;
      mark(null);
      if (isLifted) {
        setLifted(false);
        // The let-go after a real drag must not also press the button underneath. A slow click that never moved
        // is still a click, so it goes through.
        if (moved) {
          const swallow = (ev: Event) => {
            ev.stopPropagation();
            ev.preventDefault();
          };
          window.addEventListener('click', swallow, true);
          window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
        }
        if (drop && moved && to) arr.moveNear(id, to);
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };
  const canPrev = arr.neighbour(id, -1, showing) >= 0;
  const canNext = arr.neighbour(id, 1, showing) >= 0;
  const btn = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 hover:border-indigo-500 disabled:opacity-30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
  if (hidden && !arranging) return null;
  const Prev = horizontal ? ArrowLeft : ArrowUp;
  const Next = horizontal ? ArrowRight : ArrowDown;
  return (
    <div
      style={{ order: i }}
      data-arrange-list={holdDrag && !arranging ? holdDrag : undefined}
      data-arrange-id={id}
      onPointerDown={startHold}
      title={holdDrag && !arranging ? 'Press and hold, then drag to move' : undefined}
      className={`${arranging ? "" : className} ${arranging ? `flex flex-row items-center gap-0.5 rounded-lg ring-2 ring-dashed ring-indigo-400/60 ${horizontal ? 'px-1' : 'p-1'}` : ''} ${lifted ? 'z-10 scale-105 cursor-grabbing select-none opacity-70 shadow-lg' : ''}`}
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
