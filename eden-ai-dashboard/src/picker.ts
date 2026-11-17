// Element picker (the pencil in the top bar): point at any part of EDEN, click to pick it, and the picks go along
// with your next Code update request or Chief message, so the AI knows exactly which element you mean.
// Works on any document, so app previews can use it too (pass their document to startPicking).
import { useEffect, useState } from 'react';

export interface Pick {
  id: string;
  label: string; // what it says or is called
  tag: string;
  components: string[]; // React components it sits in, innermost first
  where: string; // nearest named areas around it
  classes: string;
}

let picks: Pick[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const getPicks = () => picks;
// Which code the picks are about: EDEN itself (empty) or a project's app (its codebase).
let target: { codebaseId: string; name: string } = { codebaseId: '', name: '' };
export const getPickTarget = () => target;
export const setPickTarget = (t: { codebaseId: string; name: string }) => { if (!picks.length || t.codebaseId !== target.codebaseId) { if (t.codebaseId !== target.codebaseId) picks = []; } target = t; emit(); };
export const addPick = (p: Omit<Pick, 'id'>) => { picks = [...picks, { id: `pk-${Date.now().toString(36)}-${picks.length}`, ...p }]; emit(); };
export const removePick = (id: string) => { picks = picks.filter((p) => p.id !== id); emit(); };
export const clearPicks = () => { picks = []; emit(); };
export function usePicks(): Pick[] {
  const [v, setV] = useState(picks);
  useEffect(() => { const l = () => setV(picks); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return v;
}

// Text added to a request so the AI can find each picked element in the code.
export function picksAsText(list: Pick[] = picks): string {
  if (!list.length) return '';
  return '\n\nElements I picked on screen (change these):\n' + list.map((p, i) =>
    `${i + 1}. "${p.label}" (<${p.tag}>${p.classes ? ` class="${p.classes}"` : ''})${p.components.length ? `, in component ${p.components.join(' < ')}` : ''}${p.where ? `, area: ${p.where}` : ''}`).join('\n');
}

const reactComponents = (el: Element): string[] => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  let f: any = key ? (el as any)[key] : null;
  const names: string[] = [];
  while (f && names.length < 4) {
    const t = f.type;
    const n = typeof t === 'function' ? t.displayName || t.name : null;
    if (n && !names.includes(n) && /^[A-Z]/.test(n)) names.push(n);
    f = f.return;
  }
  return names;
};

export function describe(el: Element): Omit<Pick, 'id'> {
  const h = el as HTMLElement;
  const text = (h.getAttribute('aria-label') || h.getAttribute('title') || h.getAttribute('placeholder') || h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim();
  const where: string[] = [];
  for (let p = el.parentElement; p && where.length < 2; p = p.parentElement) {
    const name = p.getAttribute('aria-label') || (/^(H1|H2|H3)$/.test(p.tagName) ? p.textContent : '');
    if (name) where.push(name.trim().slice(0, 40));
  }
  return {
    label: text.slice(0, 80) || `(${el.tagName.toLowerCase()})`,
    tag: el.tagName.toLowerCase(),
    components: reactComponents(el),
    where: where.join(' › '),
    classes: (typeof h.className === 'string' ? h.className : '').split(/\s+/).filter(Boolean).slice(0, 6).join(' '),
  };
}

// Picking mode: a box follows the pointer; a click picks (and doesn't press the thing); Esc or stop() ends it.
export function startPicking(doc: Document = document, onEnd?: () => void): () => void {
  const box = doc.createElement('div');
  box.setAttribute('data-eden-picker', '');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #6366f1;background:rgba(99,102,241,.12);border-radius:4px;transition:all .05s;display:none';
  const tag = doc.createElement('div');
  tag.style.cssText = 'position:absolute;left:0;top:-22px;font:12px system-ui;background:#6366f1;color:#fff;padding:1px 6px;border-radius:4px;white-space:nowrap';
  box.appendChild(tag);
  doc.body.appendChild(box);
  const skip = (t: EventTarget | null) => !(t instanceof Element) || !!t.closest('[data-eden-picker],[data-eden-picker-ui]');
  const move = (e: MouseEvent) => {
    if (skip(e.target)) { box.style.display = 'none'; return; }
    const r = (e.target as Element).getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    tag.textContent = reactComponents(e.target as Element)[0] || (e.target as Element).tagName.toLowerCase();
  };
  const press = (e: PointerEvent) => {
    if (skip(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (target.codebaseId) { picks = []; target = { codebaseId: '', name: '' }; } // picking EDEN itself again
    picks = [...picks, { id: `pk-${Date.now().toString(36)}-${picks.length}`, ...describe(e.target as Element) }];
    emit();
  };
  const block = (e: Event) => { if (!skip(e.target)) { e.preventDefault(); e.stopPropagation(); } };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') stop(); };
  doc.addEventListener('mousemove', move, true);
  doc.addEventListener('pointerdown', press, true); // pointer events still reach disabled buttons
  doc.addEventListener('click', block, true);
  doc.addEventListener('mousedown', block, true);
  doc.addEventListener('mouseup', block, true);
  doc.addEventListener('keydown', key, true);
  let done = false;
  function stop() {
    if (done) return;
    done = true;
    doc.removeEventListener('mousemove', move, true);
    doc.removeEventListener('pointerdown', press, true);
    doc.removeEventListener('click', block, true);
    doc.removeEventListener('mousedown', block, true);
    doc.removeEventListener('mouseup', block, true);
    doc.removeEventListener('keydown', key, true);
    box.remove();
    onEnd?.();
  }
  return stop;
}
