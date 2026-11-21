import React, { useEffect, useRef } from 'react';
import { GripHorizontal, Minimize2 } from 'lucide-react';

// A widget that has been "popped out" of the dashboard: it floats above the page, you can drag it
// by its title bar, and "Dock" puts it back in the widget bar.

interface FloatingWidgetProps {
  title: string;
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
  onDock: () => void;
  children: React.ReactNode;
}

export function FloatingWidget({ title, x, y, onMove, onDock, children }: FloatingWidgetProps) {
  const grab = useRef<{ dx: number; dy: number } | null>(null);

  const clamp = (nx: number, ny: number) => ({
    x: Math.max(0, Math.min(nx, window.innerWidth - 160)),
    y: Math.max(0, Math.min(ny, window.innerHeight - 48)),
  });

  // A saved position can be off-screen (smaller window, another device, a rotated tablet): pull it back into view
  // now and whenever the window changes size, so the title bar can always be reached.
  useEffect(() => {
    const fit = () => { const p = clamp(x, y); if (p.x !== x || p.y !== y) onMove(p.x, p.y); };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  return (
    <div
      role="dialog"
      aria-label={`${title} (popped out)`}
      style={{ left: x, top: y }}
      className="fixed z-40 w-[min(22rem,calc(100vw-1rem))] rounded-xl border border-indigo-300 bg-white shadow-2xl dark:border-indigo-700 dark:bg-slate-900"
    >
      <div
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          grab.current = { dx: e.clientX - x, dy: e.clientY - y };
        }}
        onPointerMove={(e) => {
          if (!grab.current) return;
          const p = clamp(e.clientX - grab.current.dx, e.clientY - grab.current.dy);
          onMove(p.x, p.y);
        }}
        onPointerUp={() => { grab.current = null; }}
        onPointerCancel={() => { grab.current = null; }}
        title="Drag to move"
        className="flex cursor-grab touch-none items-center gap-2 rounded-t-xl border-b border-slate-200 bg-slate-50 px-3 py-2 active:cursor-grabbing dark:border-slate-800 dark:bg-slate-800/60"
      >
        <GripHorizontal className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
        <button onClick={onDock} title="Dock back into the sidebar" className="flex shrink-0 items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
          <Minimize2 className="h-3 w-3" /> Dock
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
    </div>
  );
}
