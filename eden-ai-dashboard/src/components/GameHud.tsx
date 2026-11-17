import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Swords } from 'lucide-react';
import { CHARACTERS, enemyFor, helperCost, levelOf, powerCost, readGameSave, useGameOn, writeGameSave, type GameSave } from '../gameMode.ts';

// Deal damage to the current enemy. Beating it gives XP and gold; the next one is stronger.
function hit(s: GameSave, dmg: number, click: boolean): GameSave {
  const foe = enemyFor(s.kills);
  const hp = (s.enemyHp > 0 ? s.enemyHp : foe.max) - dmg;
  const next = { ...s, clicks: s.clicks + (click ? 1 : 0) };
  if (hp > 0) return { ...next, enemyHp: hp };
  const reward = Math.ceil(foe.max / 2) * (foe.boss ? 3 : 1);
  return { ...next, kills: s.kills + 1, xp: s.xp + reward, gold: s.gold + reward, enemyHp: 0 };
}

const btn =
  'game-btn rounded-none border-2 border-slate-900 bg-amber-300 px-2 py-1 text-xs font-bold text-slate-900 shadow-[2px_2px_0_0_#0f172a] enabled:hover:bg-amber-200 enabled:active:translate-x-0.5 enabled:active:translate-y-0.5 enabled:active:shadow-none disabled:opacity-40';

// The little game in the corner (Account → Preferences → Options turns it on). Everything stays on this device.
export const GameHud: React.FC = () => {
  const [on] = useGameOn();
  const [save, setSave] = useState<GameSave>(readGameSave);
  const [open, setOpen] = useState(true);
  const [swing, setSwing] = useState(0); // changes on every hit so the enemy shakes again
  const [note, setNote] = useState('');
  const lastLevel = useRef(levelOf(save.xp).level);

  // Keep what you earned, and pick up a reset made in Options.
  useEffect(() => {
    writeGameSave(save);
  }, [save]);
  useEffect(() => {
    const reread = () => setSave(readGameSave());
    window.addEventListener('eden-game-mode', reread);
    return () => window.removeEventListener('eden-game-mode', reread);
  }, []);

  // Helpers fight for you once a second.
  useEffect(() => {
    if (!on || save.helpers <= 0) return;
    const id = setInterval(() => setSave((s) => hit(s, s.helpers, false)), 1000);
    return () => clearInterval(id);
  }, [on, save.helpers > 0, save.helpers]);

  const { level, into, need } = levelOf(save.xp);
  useEffect(() => {
    if (level > lastLevel.current) {
      setNote(`LEVEL UP! You are level ${level}.`);
      const t = setTimeout(() => setNote(''), 3000);
      lastLevel.current = level;
      return () => clearTimeout(t);
    }
    lastLevel.current = level;
  }, [level]);

  if (!on) return null;

  const foe = enemyFor(save.kills);
  const hp = save.enemyHp > 0 ? save.enemyHp : foe.max;
  const me = CHARACTERS.find((c) => c.id === save.character) || CHARACTERS[0];
  const attack = () => {
    setSwing((n) => n + 1);
    setSave((s) => hit(s, s.power, true));
  };
  const buyPower = () => setSave((s) => (s.gold >= powerCost(s.power) ? { ...s, gold: s.gold - powerCost(s.power), power: s.power + 1 } : s));
  const buyHelper = () => setSave((s) => (s.gold >= helperCost(s.helpers) ? { ...s, gold: s.gold - helperCost(s.helpers), helpers: s.helpers + 1 } : s));

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label={`Open the game. Level ${level}`}
        className="game-panel fixed bottom-20 right-3 z-30 flex items-center gap-2 rounded-none border-2 border-slate-900 bg-slate-800 px-3 py-1.5 text-xs font-bold text-amber-300 shadow-[3px_3px_0_0_#0f172a] md:bottom-14"
      >
        <Swords className="h-4 w-4" /> LV {level}
      </button>
    );
  }

  return (
    <section
      aria-label="Eden game"
      className="game-panel fixed bottom-20 right-3 z-30 w-64 max-w-[calc(100vw-1.5rem)] rounded-none border-2 border-slate-900 bg-slate-800 p-3 text-slate-100 shadow-[4px_4px_0_0_#0f172a] md:bottom-14"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold tracking-wider text-amber-300">{me.icon} {me.label.toUpperCase()} · LV {level}</div>
        <button onClick={() => setOpen(false)} aria-label="Hide the game" className="rounded p-0.5 text-slate-300 hover:bg-slate-700">
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2" role="progressbar" aria-label="XP" aria-valuemin={0} aria-valuemax={need} aria-valuenow={into}>
        <div className="h-3 border-2 border-slate-900 bg-slate-950">
          <div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.min(100, (into / need) * 100)}%` }} />
        </div>
        <div className="mt-0.5 text-[0.65rem] text-slate-300">XP {into} / {need}</div>
      </div>

      <div className="mt-3 flex items-center justify-around border-2 border-slate-900 bg-slate-900/70 py-2">
        <span className="text-3xl" aria-hidden>{me.icon}</span>
        <span className="text-xs font-bold text-slate-400" aria-hidden>VS</span>
        <button onClick={attack} aria-label={`Attack the ${foe.name}`} className="game-foe select-none text-4xl" key={swing} data-boss={foe.boss ? '' : undefined}>
          {foe.icon}
        </button>
      </div>
      <div className="mt-1.5">
        <div className="flex justify-between text-[0.65rem] text-slate-300">
          <span>{foe.boss ? 'BOSS ' : ''}{foe.name}</span>
          <span>{hp} / {foe.max} HP</span>
        </div>
        <div className="h-2.5 border-2 border-slate-900 bg-slate-950">
          <div className="h-full bg-red-500 transition-all" style={{ width: `${Math.max(0, (hp / foe.max) * 100)}%` }} />
        </div>
      </div>
      <button onClick={attack} className={`${btn} mt-2 w-full`}>ATTACK (click the enemy too)</button>

      <div className="mt-2 flex justify-between text-[0.65rem] text-slate-300">
        <span>🪙 {save.gold} gold</span>
        <span>Wins: {save.kills}</span>
        <span>Clicks: {save.clicks}</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={buyPower} disabled={save.gold < powerCost(save.power)} className={btn} title="Each click hits harder">
          Power {save.power}<br />🪙 {powerCost(save.power)}
        </button>
        <button onClick={buyHelper} disabled={save.gold < helperCost(save.helpers)} className={btn} title="Helpers fight for you every second, even when you are not clicking">
          Helper {save.helpers}<br />🪙 {helperCost(save.helpers)}
        </button>
      </div>

      <div className="mt-2 flex gap-1" role="group" aria-label="Pick your character">
        {CHARACTERS.map((c) => (
          <button
            key={c.id}
            onClick={() => setSave((s) => ({ ...s, character: c.id }))}
            aria-pressed={c.id === save.character}
            aria-label={c.label}
            title={c.label}
            className={`flex-1 border-2 py-0.5 text-lg ${c.id === save.character ? 'border-amber-300 bg-slate-700' : 'border-slate-900 bg-slate-900/60 hover:bg-slate-700'}`}
          >
            {c.icon}
          </button>
        ))}
      </div>

      {note && <p role="status" className="game-levelup mt-2 text-center text-xs font-bold text-amber-300">{note}</p>}
    </section>
  );
};
