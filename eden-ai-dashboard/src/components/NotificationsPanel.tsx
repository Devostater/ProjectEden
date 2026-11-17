import React from 'react';
import { AlertTriangle, Inbox, Loader2, XCircle, CheckCircle2, X } from 'lucide-react';
import type { UpdatesFeed } from '../readyUpdates.ts';

const short = (t: string, n = 80) => (t.length > n ? `${t.slice(0, n)}…` : t);

// What the notification button counts: things that need you (a click), and news you haven't looked at yet.
export const countNotifications = (feed: UpdatesFeed, reviewCount: number) => {
  const needs = reviewCount + feed.ready.length + (feed.restartPending ? 1 : 0);
  const news = feed.running.length + feed.failed.length + feed.finished.length;
  return { needs, news };
};

const Row: React.FC<{ icon: React.ReactNode; title: string; detail?: string; action?: string; onClick?: () => void }> = ({ icon, title, detail, action, onClick }) => (
  <li className="flex items-start gap-2.5 px-3 py-2">
    <span className="mt-0.5 shrink-0">{icon}</span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm text-slate-900 dark:text-white">{title}</span>
      {detail && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{detail}</span>}
    </span>
    {action && onClick && (
      <button onClick={onClick} className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
        {action}
      </button>
    )}
  </li>
);

// The drop-down under the top bar's notification button.
// "Needs you" is what waits for a click. "Good to know" is news that needs no click, until you visit the Code updates page.
export const NotificationsPanel = React.forwardRef<
  HTMLDivElement,
  { feed: UpdatesFeed; reviewCount: number; onClose: () => void; onReview: () => void; onOpenUpdates: () => void }
>(({ feed, reviewCount, onClose, onReview, onOpenUpdates }, ref) => {
  const { needs, news } = countNotifications(feed, reviewCount);
  const go = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <div ref={ref} className="absolute left-2 top-full z-30 mt-1 flex max-h-[70vh] w-[26rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <span className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</span>
        <button onClick={onClose} aria-label="Close notifications" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {needs + news === 0 && <p className="p-4 text-sm text-slate-500 dark:text-slate-400">All clear: nothing needs you and there is no news.</p>}
        {needs > 0 && (
          <section>
            <h3 className="bg-amber-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Needs you</h3>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {feed.restartPending && (
                <Row icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} title="Restart needed" detail="An update changed the server part of the hub. It only takes effect after a restart." action="Open to restart" onClick={go(onOpenUpdates)} />
              )}
              {feed.ready.length > 0 && (
                <Row
                  icon={<Inbox className="h-4 w-4 text-amber-500" />}
                  title={`${feed.ready.length} code ${feed.ready.length === 1 ? 'update is' : 'updates are'} ready to apply`}
                  detail={feed.ready.slice(0, 2).map((u) => short(u.request, 40)).join(' · ')}
                  action="Review"
                  onClick={go(onOpenUpdates)}
                />
              )}
              {reviewCount > 0 && (
                <Row icon={<Inbox className="h-4 w-4 text-amber-500" />} title={`${reviewCount} finished ${reviewCount === 1 ? 'task is' : 'tasks are'} waiting for your review`} action="Review" onClick={go(onReview)} />
              )}
            </ul>
          </section>
        )}
        {news > 0 && (
          <section>
            <h3 className="bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">Good to know</h3>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {feed.running.length > 0 && (
                <Row
                  icon={<Loader2 className="h-4 w-4 animate-spin text-indigo-500" />}
                  title={`${feed.running.length} code ${feed.running.length === 1 ? 'update is' : 'updates are'} running or waiting`}
                  detail={short(feed.running[0].request, 60)}
                  action="Look"
                  onClick={go(onOpenUpdates)}
                />
              )}
              {feed.failed.map((u) => (
                <Row key={u.id} icon={<XCircle className="h-4 w-4 text-red-500" />} title="An update did not work out" detail={short(u.request)} action="Look" onClick={go(onOpenUpdates)} />
              ))}
              {feed.finished.map((u) => (
                <Row key={u.id} icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} title={`An update was ${u.status}`} detail={short(u.request)} action="Look" onClick={go(onOpenUpdates)} />
              ))}
            </ul>
            <p className="px-3 pb-2 pt-1 text-xs text-slate-500 dark:text-slate-400">The finished and failed ones clear once you open Code updates.</p>
          </section>
        )}
      </div>
    </div>
  );
});
NotificationsPanel.displayName = 'NotificationsPanel';
