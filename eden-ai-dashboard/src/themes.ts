// Eden themes. Each is light or dark plus an accent (and, for dark ones, a background tint). They work by
// re-pointing Tailwind's indigo (the accent used across the app) and slate (backgrounds) colour variables,
// so every page follows without changes. The choice is saved on this device.
export interface EdenTheme { id: string; label: string; dark: boolean; swatch: [string, string] }
export const THEMES: EdenTheme[] = [
  { id: 'light', label: 'Light', dark: false, swatch: ['#ffffff', '#6366f1'] },
  { id: 'dark', label: 'Dark', dark: true, swatch: ['#0f172a', '#6366f1'] },
  { id: 'midnight', label: 'Midnight', dark: true, swatch: ['#05060a', '#8b5cf6'] },
  { id: 'octo', label: 'Octo', dark: true, swatch: ['#0b0b0d', '#f97316'] },
  { id: 'forest', label: 'Forest', dark: true, swatch: ['#06130d', '#10b981'] },
  { id: 'ocean', label: 'Ocean', dark: true, swatch: ['#04111c', '#06b6d4'] },
  { id: 'rose', label: 'Rose', dark: true, swatch: ['#14070b', '#f43f5e'] },
  { id: 'sunrise', label: 'Sunrise', dark: false, swatch: ['#fffbeb', '#f59e0b'] },
];
const KEY = 'eden_theme';

export function loadTheme(): string {
  try {
    const t = localStorage.getItem(KEY);
    if (t && THEMES.some((x) => x.id === t)) return t;
    return localStorage.getItem('nexus_theme') === 'light' ? 'light' : 'dark'; // the older light/dark switch
  } catch {
    return 'dark';
  }
}

export function applyTheme(id: string) {
  const t = THEMES.find((x) => x.id === id) || THEMES[1];
  const root = document.documentElement;
  root.classList.toggle('dark', t.dark);
  root.dataset.edenTheme = t.id;
  try {
    localStorage.setItem(KEY, t.id);
    localStorage.setItem('nexus_theme', t.dark ? 'dark' : 'light');
  } catch {}
}
