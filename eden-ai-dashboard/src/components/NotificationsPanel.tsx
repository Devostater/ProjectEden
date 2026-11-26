import React from 'react';
import { AlertTriangle, CalendarClock, Inbox, Loader2, XCircle, CheckCircle2, X } from 'lucide-react';
import type { UpdatesFeed } from '../readyUpdates.ts';
import { HEADS_UP_CHOICES, type HeadsUp } from '../meetingHeadsUp.ts';
import { ReviewSaveRow, useReposToReview, collapseNotices } from './ReviewSaveRow.tsx';

const short = (t: string, n = 80) => (t.length > n ? `${t.slice(0, n)}…` : t);

// "in 12 minutes", "in 1 hour", or "starting now".
const startsIn = (at: number) => {
  const mins = Math.max(0, Math.round((at - Date.now()) / 60000));
  if (mins < 1) return 'starting now';
  if (mins < 60) return `in ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `in ${h} ${h === 1 ? 'hour' : 'hours'}${m ? ` ${m} min` : ''}`;
};

// What the notification button counts: things that need you (a click), and news you haven't looked at yet.
// A meeting heads-up counts as needing you, because it is time sensitive.
export const countNotifications = (feed: UpdatesFeed, reviewCount: number, headsUpCount = 0) => {
  const needs = reviewCount + feed.ready.length + (feed.restartPending ? 1 : 0) + headsUpCount;
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
  { feed: UpdatesFeed; reviewCount: number; headsUp: HeadsUp[]; headsUpMinutes: number; onHeadsUpMinutes: (m: number) => void; onDismissHeadsUp: (h: HeadsUp) => void; onOpenMeetings: () => void; onClose: () => void; onReview: () => void; onOpenUpdates: () => void }
>(({ feed, reviewCount, headsUp, headsUpMinutes, onHeadsUpMinutes, onDismissHeadsUp, onOpenMeetings, onClose, onReview, onOpenUpdates }, ref) => {
  const { needs, news } = countNotifications(feed, reviewCount, headsUp.length);
  const go = (fn: () => void) => () => { onClose(); fn(); };
  // Project folders not in step with GitHub: one "Review & save" row per project with unsaved files; every other
  // sync notice with the same words is shown once, with a count.
  const { repos, reload } = useReposToReview();
  const toSave = repos.filter((r) => r.reason === 'uncommitted' && r.projectId);
  const otherNotices = collapseNotices(repos.filter((r) => !(r.reason === 'uncommitted' && r.projectId)).map((r) => r.hint || `${r.name || 'A project'}: needs a sync`));
  return (
    <div ref={ref} className="absolute left-2 top-full z-30 mt-1 flex max-h-[70vh] w-[26rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <span className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</span>
        <button onClick={onClose} aria-label="Close notifications" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {needs + news === 0 && repos.length === 0 && <p className="p-4 text-sm text-slate-500 dark:text-slate-400">All clear: nothing needs you and there is no news.</p>}
        {repos.length > 0 && (
          <section>
            <h3 className="bg-amber-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Waiting to be saved</h3>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {toSave.map((r) => <ReviewSaveRow key={r.name} repo={r} onDone={reload} />)}
              {otherNotices.map((n) => (
                <Row key={n.text} icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} title={n.count > 1 ? `${n.text} (×${n.count})` : n.text} />
              ))}
            </ul>
          </section>
        )}
        {needs > 0 && (
          <section>
            <h3 className="bg-amber-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Needs you</h3>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {headsUp.map((h) => (
                <li key={`${h.key}@${h.at}`} className="flex items-start gap-2.5 px-3 py-2">
                  <span className="mt-0.5 shrink-0"><CalendarClock className="h-4 w-4 text-amber-500" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-900 dark:text-white">{short(h.title, 50)} is {startsIn(h.at)}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {new Date(h.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{h.project ? ` · ${h.project}` : ''}
                    </span>
                  </span>
                  {h.key.startsWith('meeting:') && (
                    <button onClick={go(onOpenMeetings)} className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Open</button>
                  )}
                  <button onClick={() => onDismissHeadsUp(h)} className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Got it</button>
                </li>
              ))}
              {feed.restartPending && (
                <Row icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} title="Restart needed" detail="An applied update only takes effect after a restart." action="Open to restart" onClick={go(onOpenUpdates)} />
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
                  detail={`${feed.running.some((u) => u.autoRetry) ? 'Re-made on the latest code: ' : ''}${short(feed.running.find((u) => u.autoRetry)?.request || feed.running[0].request, 60)}`}
                  action="Look"
                  onClick={go(onOpenUpdates)}
                />
              )}
              {feed.failed.map((u) => (
                <Row key={u.id} icon={<XCircle className="h-4 w-4 text-red-500" />} title={u.autoRetry ? 'The automatic retry did not work out' : 'An update did not work out'} detail={u.autoRetry ? `Press Try again in Code updates: ${short(u.request, 50)}` : short(u.request)} action="Look" onClick={go(onOpenUpdates)} />
              ))}
              {feed.finished.map((u) => (
                <Row key={u.id} icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} title={`An update was ${u.status}`} detail={short(u.request)} action="Look" onClick={go(onOpenUpdates)} />
              ))}
            </ul>
            <p className="px-3 pb-2 pt-1 text-xs text-slate-500 dark:text-slate-400">The finished and failed ones clear once you open Code updates.</p>
          </section>
        )}
      </div>
      <div className="border-t border-slate-100 px-3 py-2 dark:border-slate-800">
        <label className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
          <span>Heads up before a meeting</span>
          <select value={headsUpMinutes} onChange={(e) => onHeadsUpMinutes(Number(e.target.value))} aria-label="Heads up before a meeting" className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
            {HEADS_UP_CHOICES.map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
          </select>
        </label>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Saved on this device. Meetings with a day but no time can't give a heads-up.</p>
      </div>
    </div>
  );
});
NotificationsPanel.displayName = 'NotificationsPanel';
