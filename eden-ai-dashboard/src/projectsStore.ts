// Projects and cards, loaded from the server and shared by the Projects page, sidebar and Dashboard.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, Card, CardColumn, CardSource } from './types/index.ts';
import { runKey } from './runs.ts';

export const COLUMNS: { id: CardColumn; label: string; hint: string }[] = [
  { id: 'todo', label: 'To do', hint: 'Ideas and work not started' },
  { id: 'ready', label: 'Ready', hint: 'Clear enough to start' },
  { id: 'doing', label: 'In progress', hint: 'Being worked on' },
  { id: 'review', label: 'Review', hint: 'Waiting for you to check' },
  { id: 'done', label: 'Done', hint: 'Finished' },
];

async function send(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [error, setError] = useState('');
  const [openCardId, setOpenCardId] = useState<string | null>(null); // the card whose form is open
  // A plan handed over from Nexus: opens "Plan with Chief" on that project with this text filled in.
  const [planRequest, setPlanRequest] = useState<{ projectId: string; goal: string; source?: Omit<CardSource, 'at'> } | null>(null);
  const lastSeen = useRef('');
  // Which lines (runs) are shown, per project. null = all. Remembered on this device.
  const [runFilters, setRunFilters] = useState<Record<string, string[] | null>>(() => {
    try {
      return JSON.parse(localStorage.getItem('eden_run_filters') || '{}');
    } catch {
      return {};
    }
  });
  const setRunFilter = (projectId: string, selected: string[] | null) => {
    setRunFilters((all) => {
      const next = { ...all, [projectId]: selected };
      if (selected === null) delete next[projectId];
      try {
        localStorage.setItem('eden_run_filters', JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  const runFilterOf = (projectId: string) => runFilters[projectId] ?? null;
  const visible = (card: Card) => {
    const f = runFilters[card.projectId];
    return !f || f.includes(runKey(card));
  };

  const refresh = useCallback(async () => {
    try {
      const d = await send('GET', '/api/projects');
      const snapshot = JSON.stringify(d);
      if (snapshot === lastSeen.current) return;
      lastSeen.current = snapshot;
      setProjects(d.projects);
      setCards(d.cards);
      setActiveId((current) => (d.projects.some((p: Project) => p.id === current) ? current : d.projects[0]?.id || ''));
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // Keep the boards current while the AI works cards in the background.
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Runs a change, reloads, and keeps any error message for the page to show.
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setError('');
    try {
      const result = await fn();
      await refresh();
      return result;
    } catch (err: any) {
      setError(err.message);
      await refresh();
      return undefined;
    }
  };

  const saveProject = async (p: Partial<Project>) => {
    const d = await run(() => send('POST', '/api/projects', p));
    if (d?.project && !p.id) setActiveId(d.project.id);
    return d?.project as Project | undefined;
  };
  const deleteProject = (id: string) => run(() => send('DELETE', `/api/projects/${id}`));
  const saveCard = async (c: Partial<Omit<Card, 'source'>> & { note?: string; source?: Omit<CardSource, 'at'> }) => (await run(() => send('POST', '/api/cards', c)))?.card as Card | undefined;
  const deleteCard = (id: string) => run(() => send('DELETE', `/api/cards/${id}`));

  // Move a card to a column, optionally just before another card. Shown immediately, then saved.
  const moveCard = (cardId: string, column: CardColumn, beforeCardId?: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    const inColumn = cards.filter((c) => c.projectId === card.projectId && c.column === column && c.id !== cardId).sort((a, b) => a.order - b.order);
    const index = beforeCardId ? inColumn.findIndex((c) => c.id === beforeCardId) : -1;
    let order: number;
    if (index < 0) order = (inColumn[inColumn.length - 1]?.order ?? 0) + 1;
    else order = ((inColumn[index - 1]?.order ?? inColumn[index].order - 1) + inColumn[index].order) / 2;
    if (card.column === column && card.order === order) return;
    lastSeen.current = '';
    setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, column, order } : c)));
    run(() => send('POST', '/api/cards', { id: cardId, column, order }));
  };

  const active = projects.find((p) => p.id === activeId) || projects[0];

  return { runFilterOf, setRunFilter, visible, planRequest, setPlanRequest, openCardId, setOpenCardId, projects, cards, active, activeId: active?.id || '', setActiveId, error, setError, refresh, saveProject, deleteProject, saveCard, deleteCard, moveCard };
}

export type ProjectsApi = ReturnType<typeof useProjects>;
