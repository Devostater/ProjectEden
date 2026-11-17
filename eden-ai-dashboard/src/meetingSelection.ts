import { useEffect, useState } from 'react';

// The meeting or event you picked on the Meetings page, shared with the right-hand panel so it can show its details.
// Notes are kept here too, so the middle and the right panel always show the same text. Saved on this device only.
export interface MeetingSelection {
  key: string; // "meeting:<projectId>" or "event:<id>"
  noteKey: string; // where its notes are saved (a project's id, or the event key)
  kind: 'project' | 'event';
  title: string;
  sub: string;
  color?: string;
  projectId?: string;
  open: string[]; // topics still to discuss
  discussed: number;
}

export const NOTES_KEY = 'eden_meetings_notes';
const CHANGED = 'eden-meeting-selection';

let selection: MeetingSelection | null = null;

function loadNotes(): Record<string, string> {
  try {
    const n = JSON.parse(localStorage.getItem(NOTES_KEY) || 'null');
    return n && typeof n === 'object' && !Array.isArray(n) ? (n as Record<string, string>) : {};
  } catch {
    return {};
  }
}
let notes: Record<string, string> = loadNotes();

export function setMeetingSelection(next: MeetingSelection | null) {
  if (JSON.stringify(next) === JSON.stringify(selection)) return;
  selection = next;
  window.dispatchEvent(new Event(CHANGED));
}

export function setMeetingNote(noteKey: string, text: string) {
  notes = { ...notes, [noteKey]: text };
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch {}
  window.dispatchEvent(new Event(CHANGED));
}

export function useMeetingSelection(): { selection: MeetingSelection | null; notes: Record<string, string> } {
  const [, setN] = useState(0);
  useEffect(() => {
    const sync = () => setN((n) => n + 1);
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, []);
  return { selection, notes };
}
