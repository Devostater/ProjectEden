// Projects and cards, loaded from the server and shared by the Projects page, sidebar and Dashboard.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, Card, CardColumn } from './types/index.ts';

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
  const [planRequest, setPlanRequest] = useState<{ projectId: string; goal: string } | null>(null);
  const lastSeen = useRef('');

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
  const saveCard = async (c: Partial<Card> & { note?: string }) => (await run(() => send('POST', '/api/cards', c)))?.card as Card | undefined;
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

  return { planRequest, setPlanRequest, openCardId, setOpenCardId, projects, cards, active, activeId: active?.id || '', setActiveId, error, setError, refresh, saveProject, deleteProject, saveCard, deleteCard, moveCard };
}

export type ProjectsApi = ReturnType<typeof useProjects>;
