import React, { useEffect, useState } from 'react';

// Profile picture with a frame. Plain frames are a coloured ring; legendary frames are animated.
export interface Frame { id: string; label: string; legendary?: boolean; ring: string; className?: string }
export const FRAMES: Frame[] = [
  { id: 'none', label: 'None', ring: 'transparent' },
  { id: 'indigo', label: 'Indigo', ring: '#6366f1' },
  { id: 'emerald', label: 'Emerald', ring: '#10b981' },
  { id: 'gold', label: 'Gold', ring: 'linear-gradient(135deg,#fde68a,#f59e0b,#b45309,#fde68a)' },
  { id: 'silver', label: 'Silver', ring: 'linear-gradient(135deg,#f8fafc,#94a3b8,#e2e8f0,#64748b)' },
  { id: 'rose', label: 'Rose', ring: 'linear-gradient(135deg,#fda4af,#e11d48)' },
  { id: 'rainbow', label: 'Prism', legendary: true, ring: 'conic-gradient(from 0deg,#f43f5e,#f59e0b,#eab308,#22c55e,#06b6d4,#6366f1,#d946ef,#f43f5e)', className: 'eden-frame-spin' },
  { id: 'inferno', label: 'Inferno', legendary: true, ring: 'conic-gradient(from 0deg,#7f1d1d,#ef4444,#f97316,#facc15,#f97316,#ef4444,#7f1d1d)', className: 'eden-frame-spin eden-frame-glow-fire' },
  { id: 'arcane', label: 'Arcane', legendary: true, ring: 'conic-gradient(from 0deg,#312e81,#8b5cf6,#22d3ee,#8b5cf6,#312e81)', className: 'eden-frame-spin-slow eden-frame-glow-arcane' },
  { id: 'aurora', label: 'Aurora', legendary: true, ring: 'conic-gradient(from 0deg,#064e3b,#34d399,#67e8f9,#a78bfa,#34d399,#064e3b)', className: 'eden-frame-spin-slow eden-frame-pulse' },
  { id: 'legend', label: 'Legend', legendary: true, ring: 'conic-gradient(from 0deg,#fde68a,#f59e0b,#fff7ed,#f59e0b,#b45309,#fde68a)', className: 'eden-frame-spin eden-frame-glow-gold' },
];

// The animations live here so the frames work anywhere the Avatar is used. Turned off for "reduce motion".
const STYLE = `
@keyframes eden-spin { to { transform: rotate(360deg); } }
@keyframes eden-pulse { 0%,100% { opacity: .75 } 50% { opacity: 1 } }
.eden-frame-spin { animation: eden-spin 3s linear infinite; }
.eden-frame-spin-slow { animation: eden-spin 7s linear infinite; }
.eden-frame-pulse { animation: eden-spin 7s linear infinite, eden-pulse 2s ease-in-out infinite; }
.eden-frame-glow-fire { filter: drop-shadow(0 0 4px #f97316); }
.eden-frame-glow-arcane { filter: drop-shadow(0 0 4px #8b5cf6); }
.eden-frame-glow-gold { filter: drop-shadow(0 0 5px #f59e0b); }
@media (prefers-reduced-motion: reduce) { .eden-frame-spin, .eden-frame-spin-slow, .eden-frame-pulse { animation: none; } }
`;
let styled = false;
const ensureStyle = () => {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const el = document.createElement('style');
  el.textContent = STYLE;
  document.head.appendChild(el);
};

export const Avatar: React.FC<{ src?: string; initial: string; frame?: string; size?: number; className?: string }> = ({ src, initial, frame = 'none', size = 28, className = '' }) => {
  ensureStyle();
  const f = FRAMES.find((x) => x.id === frame) || FRAMES[0];
  const pad = f.id === 'none' ? 0 : Math.max(2, Math.round(size / 14));
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${className}`} style={{ width: size, height: size }}>
      {f.id !== 'none' && <span aria-hidden className={`absolute inset-0 rounded-full ${f.className || ''}`} style={{ background: f.ring }} />}
      <span className="relative flex items-center justify-center overflow-hidden rounded-full bg-indigo-100 font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300" style={{ width: size - pad * 2, height: size - pad * 2, fontSize: Math.max(10, size * 0.4) }}>
        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initial}
      </span>
    </span>
  );
};

// The profile, shared by the left bar and the Account tab. Changes are announced with an event.
export const PROFILE_EVENT = 'eden-profile-changed';
export interface ProfileData { avatar: string; frame: string; bio: string; links: { label: string; url: string }[]; commands: { label: string; text: string }[]; playerLevel: number; workTitle: string; gameTitle: string; prestige: number; credits: number; diamonds: number; playerClass: string; xp: number; stats: { creativity: number; logic: number; charm: number; luck: number } }
// Fill in anything an older hub doesn't send yet (fields added by later updates, before the hub restarts), so the
// profile card never reads a missing field and crashes. Used for both loading and saving.
export function normalizeProfile(d: any): ProfileData | null {
  if (!d || typeof d !== 'object') return null;
  const num = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const st = d.stats && typeof d.stats === 'object' ? d.stats : {};
  return {
    ...d,
    avatar: str(d.avatar), frame: str(d.frame), bio: str(d.bio),
    workTitle: str(d.workTitle), gameTitle: str(d.gameTitle), playerClass: str(d.playerClass),
    playerLevel: Math.max(1, num(d.playerLevel, 1)),
    prestige: num(d.prestige, 0), credits: num(d.credits, 0), diamonds: num(d.diamonds, 0), xp: num(d.xp, 0),
    links: Array.isArray(d.links) ? d.links.filter((l: any) => l && typeof l.label === 'string' && typeof l.url === 'string') : [],
    commands: Array.isArray(d.commands) ? d.commands.filter((c: any) => c && typeof c.label === 'string' && typeof c.text === 'string') : [],
    stats: { creativity: num(st.creativity, 10), logic: num(st.logic, 10), charm: num(st.charm, 10), luck: num(st.luck, 10) },
  };
}
export function useProfile(): ProfileData | null {
  const [p, setP] = useState<ProfileData | null>(null);
  useEffect(() => {
    const load = () =>
      fetch('/api/profile')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { const p = normalizeProfile(d); if (p) setP(p); })
        .catch(() => {});
    load();
    window.addEventListener(PROFILE_EVENT, load);
    return () => window.removeEventListener(PROFILE_EVENT, load);
  }, []);
  return p;
}
