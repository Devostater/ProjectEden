import React, { useEffect, useState } from 'react';
import { Trophy, Lock, CheckCircle2, Heart, SlidersHorizontal, Wrench, Palette, Brain, Clover, Copy } from 'lucide-react';
import { ACHIEVEMENTS, STAT_RULES, earnedStats, readNotices, readUnlocked, recordActivity, resetActivity, setNotices, statPoints, unlockedIds, useActivity, ACTIVITY_EVENT, UNLOCK_EVENT, type StatKey } from '../earned.ts';
import { useGameOn } from '../gameMode.ts';

// Achievements, the points behind your profile stats, special thanks, a few extra settings and a panel for the developer.
const card = 'rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900';
const h = 'text-sm font-semibold text-slate-900 dark:text-white';
const sub = 'text-xs text-slate-500 dark:text-slate-400';
const button = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800';

type Tab = 'achievements' | 'points' | 'thanks' | 'settings' | 'dev';
const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'achievements', label: 'Achievements', icon: Trophy },
  { id: 'points', label: 'Earned points', icon: Brain },
  { id: 'thanks', label: 'Special thanks', icon: Heart },
  { id: 'settings', label: 'Extra settings', icon: SlidersHorizontal },
  { id: 'dev', label: 'Dev panel', icon: Wrench },
];

const STAT_INFO: { key: StatKey; label: string; hint: string; Icon: React.ElementType; color: string }[] = [
  { key: 'creativity', label: 'Creativity', hint: 'Ideas, art and design', Icon: Palette, color: 'text-pink-500' },
  { key: 'logic', label: 'Logic', hint: 'Problem solving and code', Icon: Brain, color: 'text-sky-500' },
  { key: 'charm', label: 'Charm', hint: 'Teamwork and talking to players', Icon: Heart, color: 'text-rose-500' },
  { key: 'luck', label: 'Luck', hint: 'Happy accidents', Icon: Clover, color: 'text-emerald-500' },
];

// Change this list to thank whoever you like. Each line is a name and what they did.
const THANKS: { name: string; why: string }[] = [
  { name: 'The Eden studio team', why: 'For using the hub every day and telling us what to fix.' },
  { name: 'Everyone who tested early versions', why: 'For patience with the rough edges.' },
  { name: 'The AI teammates', why: 'For doing the work around the clock.' },
  { name: 'React, Vite, Express, Tailwind and Lucide', why: 'The free tools this hub is built on.' },
];

// Small notice in the corner when an achievement unlocks. Shown by App.
export const AchievementToasts: React.FC = () => {
  const [items, setItems] = useState<{ id: number; titles: string[] }[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const titles = (e as CustomEvent<string[]>).detail;
      if (!Array.isArray(titles) || !titles.length) return;
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, titles }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 6000);
    };
    window.addEventListener(UNLOCK_EVENT, on);
    return () => window.removeEventListener(UNLOCK_EVENT, on);
  }, []);
  if (!items.length) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed right-4 top-16 z-50 flex max-w-xs flex-col gap-2">
      {items.map((i) => (
        <div key={i.id} className="pointer-events-auto flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 shadow-lg dark:border-amber-500/40 dark:bg-amber-950 dark:text-amber-100">
          <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <span><b>Achievement unlocked</b><br />{i.titles.join(', ')}</span>
        </div>
      ))}
    </div>
  );
};

export const AchievementsView: React.FC = () => {
  const [tab, setTab] = useState<Tab>('achievements');
  const a = useActivity();
  const [unlocked, setUnlocked] = useState(readUnlocked);
  useEffect(() => {
    const sync = () => setUnlocked(readUnlocked());
    sync();
    window.addEventListener(ACTIVITY_EVENT, sync);
    return () => window.removeEventListener(ACTIVITY_EVENT, sync);
  }, []);
  const done = unlockedIds(a);
  const stats = earnedStats(a);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white"><Trophy className="h-5 w-5 text-amber-500" aria-hidden /> Achievements</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Everything you do in Eden earns points and achievements. {done.length} of {ACHIEVEMENTS.length} unlocked.</p>
      </div>

      <div role="tablist" aria-label="Achievements sections" className="flex flex-wrap gap-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border-2 px-3 text-sm font-semibold ${tab === id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'}`}>
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {tab === 'achievements' && (
        <section className={`${card} space-y-3`}>
          <div role="progressbar" aria-label="Achievements unlocked" aria-valuemin={0} aria-valuemax={ACHIEVEMENTS.length} aria-valuenow={done.length} className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${(done.length / ACHIEVEMENTS.length) * 100}%` }} />
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {ACHIEVEMENTS.map((x) => {
              const on = done.includes(x.id);
              return (
                <li key={x.id} className={`flex items-start gap-3 rounded-lg border p-3 ${on ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10' : 'border-slate-200 dark:border-slate-700'}`}>
                  {on ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-label="Unlocked" /> : <Lock className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-label="Locked" />}
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${on ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>{x.title}</p>
                    <p className={sub}>{x.how}</p>
                    {on && unlocked[x.id] ? <p className={sub}>Unlocked {new Date(unlocked[x.id]).toLocaleDateString()}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {tab === 'points' && (
        <section className={`${card} space-y-4`}>
          <p className="text-sm text-slate-600 dark:text-slate-300">These four stats show on your profile card in Account. You cannot type them in: you earn them by using Eden. Every stat starts at 1 and stops at 99. Points are never taken away if you delete something.</p>
          {STAT_INFO.map((s) => (
            <div key={s.key}>
              <h2 className={`${h} flex items-center gap-1.5`}><s.Icon className={`h-4 w-4 ${s.color}`} aria-hidden /> {s.label}: {stats[s.key]} <span className="font-normal text-slate-500 dark:text-slate-400">· {s.hint} · {statPoints(a, s.key).toLocaleString()} points</span></h2>
              <ul className="mt-1 space-y-1 text-sm text-slate-700 dark:text-slate-200">
                {STAT_RULES[s.key].map((r) => (
                  <li key={r.how}>+{r.per} · {r.how} <span className={sub}>(you have {r.count(a).toLocaleString()} {r.unit})</span></li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {tab === 'thanks' && (
        <section className={`${card} space-y-3`}>
          <h2 className={h}>Special thanks</h2>
          <ul className="space-y-2">
            {THANKS.map((t) => (
              <li key={t.name} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                <Heart className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden />
                <span><b className="text-slate-900 dark:text-white">{t.name}</b> · {t.why}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'settings' && <ExtraSettings />}
      {tab === 'dev' && <DevPanel />}
    </div>
  );
};

const ExtraSettings: React.FC = () => {
  const [gameOn, setGameOn] = useGameOn();
  const [notices, setN] = useState(readNotices);
  const [confirm, setConfirm] = useState(false);
  const row = 'flex items-start justify-between gap-3 border-b border-slate-100 py-3 last:border-0 dark:border-slate-800';
  return (
    <section className={card}>
      <h2 className={h}>Extra settings</h2>
      <div className="mt-1">
        <label className={row}>
          <span><span className="block text-sm font-medium text-slate-900 dark:text-white">Tell me when I unlock an achievement</span><span className={sub}>A small message in the corner. Saved on this device.</span></span>
          <input type="checkbox" checked={notices} onChange={(e) => { setNotices(e.target.checked); setN(e.target.checked); }} className="mt-1 h-5 w-5" />
        </label>
        <label className={row}>
          <span><span className="block text-sm font-medium text-slate-900 dark:text-white">Video game look</span><span className={sub}>Levels, XP and an idle game. The same switch as Account → Preferences.</span></span>
          <input type="checkbox" checked={gameOn} onChange={(e) => setGameOn(e.target.checked)} className="mt-1 h-5 w-5" />
        </label>
        <div className={row}>
          <span><span className="block text-sm font-medium text-slate-900 dark:text-white">Start the points and achievements again</span><span className={sub}>Sets every earned point and achievement back to zero on this device. Your projects and files are not touched.</span></span>
          {confirm ? (
            <span className="flex shrink-0 gap-2">
              <button onClick={() => { resetActivity(); setConfirm(false); }} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500">Yes, start again</button>
              <button onClick={() => setConfirm(false)} className={button}>Keep them</button>
            </span>
          ) : (
            <button onClick={() => setConfirm(true)} className={`${button} shrink-0`}>Start again…</button>
          )}
        </div>
      </div>
    </section>
  );
};

// For whoever builds Eden: the raw numbers behind the points, what this device has saved, and a few test buttons.
const DevPanel: React.FC = () => {
  const a = useActivity();
  const [copied, setCopied] = useState(false);
  const keys = (() => {
    try {
      return Object.keys(localStorage).filter((k) => k.startsWith('eden') || k.startsWith('nexus')).sort().map((k) => ({ key: k, size: (localStorage.getItem(k) || '').length }));
    } catch {
      return [];
    }
  })();
  const info = JSON.stringify({ activity: a, unlocked: readUnlocked(), stats: earnedStats(a), savedKeys: keys, window: `${window.innerWidth}x${window.innerHeight}`, browser: navigator.userAgent }, null, 2);
  return (
    <section className={`${card} space-y-3`}>
      <h2 className={h}>Dev panel</h2>
      <p className={sub}>Numbers for the person building Eden. Nothing here is needed to use the hub.</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => recordActivity({})} className={button}>Check achievements now</button>
        <button onClick={() => window.dispatchEvent(new CustomEvent(UNLOCK_EVENT, { detail: ['Test achievement'] }))} className={button}>Show a test notice</button>
        <button onClick={() => navigator.clipboard?.writeText(info).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {})} className={button}><Copy className="h-4 w-4" aria-hidden /> {copied ? 'Copied' : 'Copy this info'}</button>
        <button onClick={() => window.location.reload()} className={button}>Reload the page</button>
      </div>
      <pre className="max-h-96 overflow-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-800 dark:bg-slate-950 dark:text-slate-200">{info}</pre>
    </section>
  );
};
