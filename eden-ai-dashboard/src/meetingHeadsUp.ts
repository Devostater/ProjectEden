// "Heads up" before a meeting: when a meeting is about to start, it shows in the Notifications list.
// You choose how early (or Off). The choice, and which heads-ups you dismissed, are saved on this device only.
// Both kinds of meeting count: the project meetings from the Meetings page, and your own events from the left bar.
import { useCallback, useEffect, useState } from 'react';
import { EVENTS_KEY, nextTime, type OwnEvent } from './components/UpcomingPanel.tsx';

export interface HeadsUp { key: string; title: string; project?: string; color?: string; at: number }

const MINUTES_KEY = 'eden_meeting_headsup';
const DISMISSED_KEY = 'eden_meeting_headsup_dismissed';
export const HEADS_UP_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'Off' },
  { minutes: 5, label: '5 minutes before' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
];

const readMinutes = (): number => {
  try {
    const v = Number(localStorage.getItem(MINUTES_KEY));
    return HEADS_UP_CHOICES.some((c) => c.minutes === v) ? v : 0;
  } catch {
    return 0;
  }
};
const readDismissed = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const readEvents = (): OwnEvent[] => {
  try {
    const v = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

// A heads-up is one meeting at one time, so a repeating event warns again each time it comes round.
const idFor = (h: HeadsUp) => `${h.key}@${h.at}`;

export const useMeetingHeadsUp = () => {
  const [minutes, setMinutesState] = useState(readMinutes);
  const [meetings, setMeetings] = useState<{ projectId: string; name: string; color: string; meeting?: string; meetingAt?: string }[]>([]);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [now, setNow] = useState(() => Date.now());

  // Only look at the meetings while the heads-up is on. Check the clock every 30 seconds.
  useEffect(() => {
    if (!minutes) return;
    const tick = () => document.visibilityState === 'visible' && setNow(Date.now());
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [minutes]);
  useEffect(() => {
    if (!minutes) return;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/meetings')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setMeetings(Array.isArray(d.meetings) ? d.meetings : []))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [minutes]);

  const setMinutes = useCallback((m: number) => {
    setMinutesState(m);
    setNow(Date.now());
    try { localStorage.setItem(MINUTES_KEY, String(m)); } catch {}
  }, []);

  let list: HeadsUp[] = [];
  if (minutes) {
    const limit = now + minutes * 60000;
    const found: HeadsUp[] = [];
    for (const m of meetings) {
      // Only meetings with a real time of day; a date alone can't give a heads-up.
      if (!m.meeting || !m.meetingAt || m.meetingAt.length <= 10) continue;
      const at = new Date(m.meetingAt).getTime();
      if (!Number.isNaN(at)) found.push({ key: `meeting:${m.projectId}`, title: m.meeting, project: m.name, color: m.color, at });
    }
    for (const e of readEvents()) {
      if (!e || typeof e.when !== 'string' || e.when.length <= 10) continue;
      const at = nextTime(e.when, e.repeat, now);
      if (!Number.isNaN(at)) found.push({ key: `event:${e.id}`, title: e.text, at });
    }
    list = found
      .filter((h) => h.at >= now && h.at <= limit && !dismissed.includes(idFor(h)))
      .sort((a, b) => a.at - b.at);
  }

  const dismiss = useCallback((h: HeadsUp) => {
    setDismissed((prev) => {
      // Keep only the last few, so the saved list never grows forever.
      const next = [...prev, idFor(h)].slice(-50);
      try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  return { minutes, setMinutes, headsUp: list, dismiss };
};
