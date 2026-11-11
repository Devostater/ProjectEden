// Nexus rooms, shared by the sidebar (which lists them) and the Nexus page (which shows one).
import { useCallback, useEffect, useRef, useState } from 'react';
import { sortRooms, type RoomSummary } from './components/NexusRooms.tsx';

const ROOM_KEY = 'eden_nexus_room';

export function useNexusRooms() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [activeId, setActive] = useState(() => {
    try {
      return localStorage.getItem(ROOM_KEY) || '';
    } catch {
      return '';
    }
  });
  const activeRef = useRef(activeId);
  const lastSeen = useRef('');

  const refresh = useCallback(async () => {
    try {
      const d = await fetch('/api/nexus/rooms').then((r) => r.json());
      const snapshot = JSON.stringify(d.rooms);
      if (snapshot !== lastSeen.current) {
        lastSeen.current = snapshot;
        setRooms(d.rooms);
      }
      // Keep the open room if it still exists, else open the first.
      if (!d.rooms.some((r: RoomSummary) => r.id === activeRef.current) && d.rooms.length) setActiveId(sortRooms(d.rooms)[0].id);
    } catch {}
  }, []);

  const setActiveId = (id: string) => {
    activeRef.current = id;
    setActive(id);
    try {
      localStorage.setItem(ROOM_KEY, id);
    } catch {}
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { rooms, activeId, setActiveId, refresh };
}

export type NexusRoomsApi = ReturnType<typeof useNexusRooms>;
