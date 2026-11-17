import React, { useEffect, useState } from 'react';
import { Upload, Trash2, Plus, X, Save, Loader2, Sparkles, ExternalLink, Play, Star, Briefcase, Gamepad2, Trophy, Coins, Gem, Swords, Palette, Brain, Heart, Clover } from 'lucide-react';
import { Avatar, FRAMES, PROFILE_EVENT, useProfile, normalizeProfile, type ProfileData } from './Avatar.tsx';
import { STAT_RULES, earnedStats, statPoints, useActivity } from '../earned.ts';
import { GAME_SAVE_EVENT, levelOf, readGameSave, writeGameSave, xpAtLevel, xpForLevel, type GameSave } from '../gameMode.ts';

// Picture, frame, bio, your links and your own quick commands (a command sends its text to Chat).
const card = 'rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900';
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white';
const h = 'text-sm font-semibold text-slate-900 dark:text-white';

// The four character stats shown on the card.
const STATS = [
  { key: 'creativity', label: 'Creativity', hint: 'Ideas, art and design', Icon: Palette, color: 'text-pink-500' },
  { key: 'logic', label: 'Logic', hint: 'Problem solving and code', Icon: Brain, color: 'text-sky-500' },
  { key: 'charm', label: 'Charm', hint: 'Teamwork and talking to players', Icon: Heart, color: 'text-rose-500' },
  { key: 'luck', label: 'Luck', hint: 'Happy accidents', Icon: Clover, color: 'text-emerald-500' },
] as const;

// Shrinks the picture to 256x256 (cropped to a square) so it stays small.
function toSmallPicture(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      c.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(img.src);
      resolve(file.type === 'image/gif' ? c.toDataURL('image/png') : c.toDataURL('image/webp', 0.85));
    };
    img.onerror = () => reject(new Error('That file is not a picture.'));
    img.src = URL.createObjectURL(file);
  });
}

export const ProfileCard: React.FC<{ name: string }> = ({ name }) => {
  const saved = useProfile();
  const [p, setP] = useState<ProfileData | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [game, setGame] = useState<GameSave>(readGameSave);
  // What is being typed in the Level and XP boxes. Nothing changes the game until Save is pressed.
  const [levelDraft, setLevelDraft] = useState<string | null>(null);
  const [xpDraft, setXpDraft] = useState<string | null>(null);
  useEffect(() => { if (saved && !p) setP(saved); }, [saved, p]);
  // A device with no game save yet (new browser, cleared storage) starts from the level saved on the hub,
  // so a level saved earlier is never lost or overwritten by a fresh 0.
  useEffect(() => {
    if (!saved || readGameSave().xp > 0) return;
    const fromHub = xpAtLevel(Math.max(1, saved.playerLevel || 1)) + Math.max(0, saved.xp || 0);
    if (fromHub > 0) {
      writeGameSave({ ...readGameSave(), xp: fromHub });
      setGame(readGameSave());
      window.dispatchEvent(new Event('eden-game-mode'));
    }
  }, [saved]);
  // Level and XP come from the Eden game, so the card and the game always show the same numbers.
  useEffect(() => {
    const reread = () => setGame(readGameSave());
    window.addEventListener(GAME_SAVE_EVENT, reread);
    window.addEventListener('eden-game-mode', reread);
    window.addEventListener('storage', reread);
    return () => {
      window.removeEventListener(GAME_SAVE_EVENT, reread);
      window.removeEventListener('eden-game-mode', reread);
      window.removeEventListener('storage', reread);
    };
  }, []);
  const activity = useActivity();
  if (!p) return null;
  // The four stats come from what you have done in Eden (see earned.ts).
  const stats = earnedStats(activity);
  const set = (patch: Partial<ProfileData>) => { setP({ ...p, ...patch }); setMsg(null); };
  const initial = (name || 'You').trim().charAt(0).toUpperCase();
  const { level, into: xpInto, need: xpNeeded } = levelOf(game.xp);
  // Saving a new level or XP changes the game too, so the two stay in step.
  const setGameXp = (xp: number) => {
    const next = { ...readGameSave(), xp };
    writeGameSave(next);
    setGame(next);
    window.dispatchEvent(new Event('eden-game-mode')); // the game picks up the new number
    setMsg(null);
  };
  // The level and XP that Save will use: what was typed (if anything), kept in range.
  const draftLevel = () => { const n = Math.floor(Number(levelDraft)); return levelDraft === null || !Number.isFinite(n) || levelDraft.trim() === '' ? level : Math.min(999, Math.max(1, n)); };
  const draftXp = (l: number) => { const need = xpForLevel(l); const n = Math.floor(Number(xpDraft)); const v = xpDraft === null || !Number.isFinite(n) || xpDraft.trim() === '' ? xpInto : n; return Math.min(need - 1, Math.max(0, v)); };

  const save = async () => {
    setBusy(true);
    try {
      const newLevel = draftLevel();
      const newXp = draftXp(newLevel);
      if (levelDraft !== null || xpDraft !== null) {
        if (newLevel !== level || newXp !== xpInto) setGameXp(xpAtLevel(newLevel) + newXp);
        setLevelDraft(null);
        setXpDraft(null);
      }
      const r = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, stats, playerLevel: newLevel, xp: newXp }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save.');
      // Keep what was typed for any field an older hub leaves out of its reply.
      setP(normalizeProfile(d && typeof d === 'object' && !Array.isArray(d) ? { ...p, ...d } : null) || p);
      setMsg({ ok: true, text: 'Profile saved.' });
      window.dispatchEvent(new Event(PROFILE_EVENT));
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
    setBusy(false);
  };

  return (
    <section className={`${card} space-y-5`}>
      <div className="flex flex-wrap items-center gap-5">
        <Avatar src={p.avatar} initial={initial} frame={p.frame} size={96} />
        <div className="space-y-2">
          <p className="text-lg font-semibold text-slate-900 dark:text-white">{name || 'Your profile'}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"><Star className="h-3.5 w-3.5" aria-hidden /> Level {level}</span>
            {p.playerClass && <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"><Swords className="h-3.5 w-3.5" aria-hidden /> {p.playerClass}</span>}
            {p.workTitle && <span className="inline-flex items-center gap-1"><Briefcase className="h-4 w-4 text-slate-400" aria-hidden /> {p.workTitle}</span>}
            {p.gameTitle && <span className="inline-flex items-center gap-1"><Gamepad2 className="h-4 w-4 text-slate-400" aria-hidden /> {p.gameTitle}</span>}
          </p>
          <div className="w-64 max-w-full">
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400"><span>Experience</span><span>{xpInto.toLocaleString()} / {xpNeeded.toLocaleString()} XP</span></div>
            <div role="progressbar" aria-label="Experience toward the next level" aria-valuemin={0} aria-valuemax={xpNeeded} aria-valuenow={xpInto} className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${Math.min(100, (xpInto / xpNeeded) * 100)}%` }} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium text-slate-800 dark:text-slate-100">
            <span title="Prestige points" className="inline-flex items-center gap-1.5"><Trophy className="h-4 w-4 text-amber-500" aria-hidden /> {p.prestige.toLocaleString()} <span className="font-normal text-slate-500 dark:text-slate-400">prestige</span></span>
            <span title="Current credits" className="inline-flex items-center gap-1.5"><Coins className="h-4 w-4 text-yellow-500" aria-hidden /> {p.credits.toLocaleString()} <span className="font-normal text-slate-500 dark:text-slate-400">credits</span></span>
            <span title="Diamonds" className="inline-flex items-center gap-1.5"><Gem className="h-4 w-4 text-cyan-500" aria-hidden /> {p.diamonds.toLocaleString()} <span className="font-normal text-slate-500 dark:text-slate-400">diamonds</span></span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-800 dark:text-slate-100">
            {STATS.map((s) => {
              const points = statPoints(activity, s.key);
              return (
                <span key={s.key} tabIndex={0} aria-label={`${s.label} ${stats[s.key]}. Earned by using Eden. Hover or focus to see how.`} className="group relative inline-flex cursor-help items-center gap-1.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                  <s.Icon className={`h-4 w-4 ${s.color}`} aria-hidden /> <span className="font-normal text-slate-500 dark:text-slate-400">{s.label}</span> <span className="font-semibold">{stats[s.key]}</span>
                  <span role="tooltip" className="pointer-events-none invisible absolute left-0 top-full z-30 mt-1 w-72 max-w-[80vw] rounded-lg border border-slate-200 bg-white p-3 text-xs font-normal text-slate-700 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <span className="block text-sm font-semibold text-slate-900 dark:text-white">{s.label}: {stats[s.key]}</span>
                    <span className="block text-slate-500 dark:text-slate-400">{s.hint}. Earned by using Eden, not typed in. You have {points.toLocaleString()} {points === 1 ? 'point' : 'points'} (every stat starts at 1 and stops at 99).</span>
                    <span className="mt-2 block font-semibold text-slate-900 dark:text-white">How to earn it</span>
                    {STAT_RULES[s.key].map((r) => (
                      <span key={r.how} className="mt-1 block">+{r.per} · {r.how} <span className="text-slate-500 dark:text-slate-400">(you have {r.count(activity).toLocaleString()} {r.unit})</span></span>
                    ))}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              <Upload className="h-4 w-4" /> Change picture
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try { set({ avatar: await toSmallPicture(f) }); } catch (err: any) { setMsg({ ok: false, text: err.message }); }
              }} />
            </label>
            {p.avatar && (
              <button onClick={() => set({ avatar: '' })} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:text-red-600 dark:border-slate-700 dark:text-slate-300">
                <Trash2 className="h-4 w-4" /> Remove
              </button>
            )}
          </div>
        </div>
      </div>

      <div>
        <h3 className={h}>Your details</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="pf-level" className="text-xs text-slate-500 dark:text-slate-400">Player level (same as the game)</label>
            <input id="pf-level" type="number" min={1} max={999} value={levelDraft ?? String(level)} onChange={(e) => { setLevelDraft(e.target.value); setMsg(null); }} className={`${input} mt-1`} />
          </div>
          <div>
            <label htmlFor="pf-work" className="text-xs text-slate-500 dark:text-slate-400">Work title</label>
            <input id="pf-work" value={p.workTitle} onChange={(e) => set({ workTitle: e.target.value })} maxLength={60} placeholder="e.g. Lead Designer" className={`${input} mt-1`} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="pf-game" className="text-xs text-slate-500 dark:text-slate-400">Video game title</label>
            <input id="pf-game" value={p.gameTitle} onChange={(e) => set({ gameTitle: e.target.value })} maxLength={80} placeholder="The game you are making" className={`${input} mt-1`} />
          </div>
          <div>
            <label htmlFor="pf-class" className="text-xs text-slate-500 dark:text-slate-400">Character class</label>
            <input id="pf-class" value={p.playerClass} onChange={(e) => set({ playerClass: e.target.value })} maxLength={40} placeholder="e.g. Game Wizard" className={`${input} mt-1`} />
          </div>
          <div>
            <label htmlFor="pf-xp" className="text-xs text-slate-500 dark:text-slate-400">Experience (XP) · {xpNeeded.toLocaleString()} needed for the next level</label>
            <input id="pf-xp" type="number" min={0} max={xpNeeded - 1} value={xpDraft ?? String(xpInto)} onChange={(e) => { setXpDraft(e.target.value); setMsg(null); }} className={`${input} mt-1`} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">Creativity, Logic, Charm and Luck are earned by using Eden. Hover one above to see how, or open the Achievements page.</p>
          <div>
            <label htmlFor="pf-prestige" className="text-xs text-slate-500 dark:text-slate-400">Prestige points</label>
            <input id="pf-prestige" type="number" min={0} value={p.prestige} onChange={(e) => set({ prestige: Math.max(0, Math.floor(Number(e.target.value)) || 0) })} className={`${input} mt-1`} />
          </div>
          <div>
            <label htmlFor="pf-credits" className="text-xs text-slate-500 dark:text-slate-400">Current credits</label>
            <input id="pf-credits" type="number" min={0} value={p.credits} onChange={(e) => set({ credits: Math.max(0, Math.floor(Number(e.target.value)) || 0) })} className={`${input} mt-1`} />
          </div>
          <div>
            <label htmlFor="pf-diamonds" className="text-xs text-slate-500 dark:text-slate-400">Diamonds</label>
            <input id="pf-diamonds" type="number" min={0} value={p.diamonds} onChange={(e) => set({ diamonds: Math.max(0, Math.floor(Number(e.target.value)) || 0) })} className={`${input} mt-1`} />
          </div>
        </div>
      </div>

      <div>
        <h3 className={h}>Frame</h3>
        <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
          {FRAMES.map((f) => (
            <button key={f.id} onClick={() => set({ frame: f.id })} aria-pressed={p.frame === f.id} title={f.legendary ? `${f.label} (legendary, animated)` : f.label}
              className={`relative flex flex-col items-center gap-1 rounded-xl border-2 p-2 text-xs ${p.frame === f.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}>
              {f.legendary && <Sparkles className="absolute right-1 top-1 h-3 w-3 text-amber-500" aria-label="legendary" />}
              <Avatar src={p.avatar} initial={initial} frame={f.id} size={44} />
              <span className={f.legendary ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}>{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="pf-bio" className={h}>About you</label>
        <textarea id="pf-bio" value={p.bio} onChange={(e) => set({ bio: e.target.value })} maxLength={300} rows={2} placeholder="What you make, what you're working on" className={`${input} mt-2`} />
      </div>

      <div>
        <h3 className={h}>Links</h3>
        <div className="mt-2 space-y-2">
          {p.links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input value={l.label} onChange={(e) => set({ links: p.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Name" aria-label="Link name" className={`${input} w-32 shrink-0`} />
              <input value={l.url} onChange={(e) => set({ links: p.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://…" aria-label="Link address" className={input} />
              {/^https?:\/\//i.test(l.url) && <a href={l.url} target="_blank" rel="noopener noreferrer" title="Open" className="flex items-center px-1 text-slate-500 hover:text-indigo-600"><ExternalLink className="h-4 w-4" /></a>}
              <button onClick={() => set({ links: p.links.filter((_, j) => j !== i) })} aria-label="Remove link" className="px-1 text-slate-400 hover:text-red-600"><X className="h-4 w-4" /></button>
            </div>
          ))}
          {p.links.length < 12 && <button onClick={() => set({ links: [...p.links, { label: '', url: '' }] })} className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline dark:text-indigo-400"><Plus className="h-4 w-4" /> Add link</button>}
        </div>
      </div>

      <div>
        <h3 className={h}>Quick commands</h3>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Things you ask often. Press ▶ to send one to Chat.</p>
        <div className="mt-2 space-y-2">
          {p.commands.map((c, i) => (
            <div key={i} className="flex gap-2">
              <input value={c.label} onChange={(e) => set({ commands: p.commands.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Name" aria-label="Command name" className={`${input} w-32 shrink-0`} />
              <input value={c.text} onChange={(e) => set({ commands: p.commands.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} placeholder="What to ask, e.g. Summarize today's work" aria-label="Command text" className={input} />
              <button disabled={!c.text.trim()} onClick={() => window.dispatchEvent(new CustomEvent('eden-ask', { detail: c.text }))} title="Send to Chat" aria-label={`Run ${c.label || 'command'}`} className="px-1 text-emerald-600 disabled:opacity-30"><Play className="h-4 w-4" /></button>
              <button onClick={() => set({ commands: p.commands.filter((_, j) => j !== i) })} aria-label="Remove command" className="px-1 text-slate-400 hover:text-red-600"><X className="h-4 w-4" /></button>
            </div>
          ))}
          {p.commands.length < 12 && <button onClick={() => set({ commands: [...p.commands, { label: '', text: '' }] })} className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline dark:text-indigo-400"><Plus className="h-4 w-4" /> Add command</button>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save profile
        </button>
        {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </section>
  );
};
