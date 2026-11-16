// Text size for people who need bigger text. The whole app is sized in rem, so changing the root font size scales
// text, buttons, icons and spacing together. Four steps; the first run starts at Large. Saved per device.
import { useEffect, useState } from 'react';

export type TextSize = 'normal' | 'large' | 'larger' | 'largest';
export const TEXT_SIZES: { id: TextSize; label: string; percent: number }[] = [
  { id: 'normal', label: 'Normal', percent: 100 },
  { id: 'large', label: 'Large', percent: 112.5 },
  { id: 'larger', label: 'Larger', percent: 125 },
  { id: 'largest', label: 'Largest', percent: 150 },
];
const KEY = 'eden_text_size';
const DEFAULT: TextSize = 'large';
const EVENT = 'eden-text-size';

export function readTextSize(): TextSize {
  try {
    const saved = localStorage.getItem(KEY) as TextSize | null;
    if (saved && TEXT_SIZES.some((s) => s.id === saved)) return saved;
  } catch {}
  return DEFAULT;
}

export function applyTextSize(id: TextSize) {
  document.documentElement.dataset.textSize = id;
}

export function setTextSize(id: TextSize) {
  try {
    localStorage.setItem(KEY, id);
  } catch {}
  applyTextSize(id);
  window.dispatchEvent(new Event(EVENT));
}

export function useTextSize(): [TextSize, (id: TextSize) => void] {
  const [size, setSize] = useState<TextSize>(readTextSize);
  useEffect(() => {
    const sync = () => {
      const now = readTextSize();
      applyTextSize(now);
      setSize(now);
    };
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync); // another tab changed it
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return [size, setTextSize];
}

// How much bigger than normal the text is (1 = Normal). From the saved choice, not computed style.
export const textScale = () => (TEXT_SIZES.find((s) => s.id === readTextSize())?.percent ?? 100) / 100;
// The root font size in pixels right now (for measuring at runtime).
export const rootPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

applyTextSize(readTextSize());
