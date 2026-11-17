// "Game mode": an optional video-game look for the hub (levels, XP, a character, battles and an idle clicker).
// It is a fun extra and OFF by default. Turn it on under Account → Preferences → Options. Saved on this device only.
import { useEffect, useState } from 'react';

const ON_KEY = 'eden_game_mode';
const SAVE_KEY = 'eden_game_save';
const EVENT = 'eden-game-mode';

export const CHARACTERS = [
  { id: 'knight', label: 'Knight', icon: '🛡️' },
  { id: 'wizard', label: 'Wizard', icon: '🧙' },
  { id: 'rogue', label: 'Rogue', icon: '🥷' },
  { id: 'robot', label: 'Robot', icon: '🤖' },
];

export const ENEMIES = [
  { name: 'Slime', icon: '🟢' },
  { name: 'Bat', icon: '🦇' },
  { name: 'Goblin', icon: '👺' },
  { name: 'Ghost', icon: '👻' },
  { name: 'Golem', icon: '🗿' },
  { name: 'Dragon', icon: '🐉' },
];

export interface GameSave {
  xp: number; // total XP earned
  gold: number;
  kills: number;
  clicks: number;
  character: string;
  power: number; // click upgrade level
  helpers: number; // idle upgrade level (damage every second without clicking)
  enemyHp: number;
}

const FRESH: GameSave = { xp: 0, gold: 0, kills: 0, clicks: 0, character: 'knight', power: 1, helpers: 0, enemyHp: 0 };

// XP needed to go from this level to the next.
export const xpForLevel = (level: number) => Math.round(40 * Math.pow(level, 1.5));

// Level, and how far into it you are, from your total XP.
export function levelOf(xp: number) {
  let level = 1;
  let left = xp;
  while (left >= xpForLevel(level)) {
    left -= xpForLevel(level);
    level++;
  }
  return { level, into: left, need: xpForLevel(level) };
}

// The enemy you are fighting depends on how many you have beaten.
export const enemyFor = (kills: number) => ({ ...ENEMIES[kills % ENEMIES.length], max: 10 + kills * 6, boss: kills % 5 === 4 });

export const powerCost = (power: number) => 10 * power * power;
export const helperCost = (helpers: number) => 25 * (helpers + 1) * (helpers + 1);

export function readGameOn(): boolean {
  try {
    return localStorage.getItem(ON_KEY) === '1';
  } catch {
    return false;
  }
}

export function readGameSave(): GameSave {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    const save = { ...FRESH, ...raw };
    for (const k of ['xp', 'gold', 'kills', 'clicks', 'power', 'helpers', 'enemyHp'] as const) {
      if (typeof save[k] !== 'number' || !isFinite(save[k]) || save[k] < 0) save[k] = FRESH[k];
    }
    if (!CHARACTERS.some((c) => c.id === save.character)) save.character = FRESH.character;
    save.power = Math.max(1, save.power);
    return save;
  } catch {
    return { ...FRESH };
  }
}

export function writeGameSave(save: GameSave) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {}
}

export function applyGameMode(on: boolean) {
  if (on) document.documentElement.dataset.game = 'on';
  else delete document.documentElement.dataset.game;
}

export function setGameOn(on: boolean) {
  try {
    localStorage.setItem(ON_KEY, on ? '1' : '0');
  } catch {}
  applyGameMode(on);
  window.dispatchEvent(new Event(EVENT));
}

export function resetGame() {
  writeGameSave({ ...FRESH });
  window.dispatchEvent(new Event(EVENT));
}

export function useGameOn(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readGameOn);
  useEffect(() => {
    const sync = () => {
      const now = readGameOn();
      applyGameMode(now);
      setOn(now);
    };
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync); // another tab changed it
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return [on, setGameOn];
}

applyGameMode(readGameOn());
