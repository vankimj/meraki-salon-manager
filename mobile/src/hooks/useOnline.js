import { useEffect, useState } from 'react';
import { checkOnline } from '../lib/connectivity';

// Reactive online/offline flag for the POS — polls the connectivity probe so
// the card button can disable itself and an "offline" notice can show. Starts
// optimistic (true) so we never block the first paint on a network round-trip.
export default function useOnline(pollMs = 15000) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let alive = true;
    const tick = async () => { const o = await checkOnline(); if (alive) setOnline(o); };
    tick();
    const id = setInterval(tick, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [pollMs]);
  return online;
}
