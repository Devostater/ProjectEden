import React, { useState } from 'react';
import { ChevronDown, GripVertical } from 'lucide-react';

// A stack of sections you can fold up with the arrow and rearrange by dragging the grip
// (or focus the grip and use the arrow keys). Folded state and order are saved on this device.

export interface SectionItem {
  id: string;
  title: string;
  body: React.ReactNode;
}

interface Saved {
  order: string[];
  collapsed: Record<string, boolean>;
}

const KEY_PREFIX = 'eden_sections_';

function load(key: string): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_PREFIX + key) || '{}');
    return {
      order: Array.isArray(raw.order) ? raw.order.filter((x: unknown) => typeof x === 'string') : [],
      collapsed: raw.collapsed && typeof raw.collapsed === 'object' ? raw.collapsed : {},
    };
  } catch {
    return { order: [], collapsed: {} };
  }
}

export function Sections({ storageKey, items, className = 'space-y-4' }: { storageKey: string; items: SectionItem[]; className?: string }) {
  const [saved, setSaved] = useState<Saved>(() => load(storageKey));
  const [dragging, setDragging] = useState<string | null>(null);

  const update = (next: Saved) => {
    setSaved(next);
    try {
      localStorage.setItem(KEY_PREFIX + storageKey, JSON.stringify(next));
    } catch {}
  };

  // Saved order first, then anything new (for example a newly cloned repo) at the end.
  const ids = items.map((i) => i.id);
  const order = [...saved.order.filter((id) => ids.includes(id)), ...ids.filter((id) => !saved.order.includes(id))];
  const byId = new Map(items.map((i) => [i.id, i]));

  const moveTo = (id: string, target: string) => {
    const from = order.indexOf(id);
    const to = order.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    update({ ...saved, order: next });
  };
  const nudge = (id: string, delta: number) => {
    const to = order.indexOf(id) + delta;
    if (to >= 0 && to < order.length) moveTo(id, order[to]);
  };
  const toggle = (id: string) => update({ ...saved, order, collapsed: { ...saved.collapsed, [id]: !saved.collapsed[id] } });

  const allFolded = order.length > 0 && order.every((id) => saved.collapsed[id]);
  const setAll = (folded: boolean) => update({ ...saved, order, collapsed: Object.fromEntries(order.map((id) => [id, folded])) });

  return (
    <div className={className}>
      {order.length > 1 && (
        <div className="flex justify-end">
          <button onClick={() => setAll(!allFolded)} className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            {allFolded ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
      )}
      {order.map((id) => {
        const item = byId.get(id)!;
        const folded = !!saved.collapsed[id];
        return (
          <div
            key={id}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              if (dragging !== id) moveTo(dragging, id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(null);
            }}
            className={`min-w-0 transition-opacity ${dragging === id ? 'opacity-60' : ''}`}
          >
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
              <span
                draggable
                onDragStart={(e) => {
                  setDragging(id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', id);
                }}
                onDragEnd={() => setDragging(null)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    nudge(id, -1);
                  } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    nudge(id, 1);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Move ${item.title}. Drag, or use the arrow keys.`}
                title="Drag to rearrange"
                className="cursor-grab rounded p-1 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
              >
                <GripVertical className="h-4 w-4" />
              </span>
              <button onClick={() => toggle(id)} aria-expanded={!folded} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-sm font-medium text-slate-700 dark:text-slate-200">
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${folded ? '-rotate-90' : ''}`} />
                <span className="truncate">{item.title}</span>
              </button>
            </div>
            {/* Hidden, not removed, so anything half-typed in a folded section is kept */}
            <div hidden={folded} className="mt-2">
              {item.body}
            </div>
          </div>
        );
      })}
    </div>
  );
}
