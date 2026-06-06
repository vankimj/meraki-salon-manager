import { useEffect, useState } from 'react';
import {
  subscribeLocations, isMultiLocation, activeLocations,
  currentLocationId, setCurrentLocationId, subscribeCurrentLocation, resolveLocation,
} from '../lib/locations';

// Compact current-location picker for the top nav. Renders NOTHING for
// single-location tenants (everyone today), so it's a zero-impact addition
// until a second active location exists. Selection persists per-tenant and
// drives per-location tax at checkout (and future per-location scoping).
export default function LocationSwitcher() {
  const [state, setState] = useState(null);
  const [cur, setCur] = useState(currentLocationId());

  useEffect(() => subscribeLocations(setState), []);
  useEffect(() => subscribeCurrentLocation(setCur), []);

  // Keep the selection valid: if the current id isn't an active location,
  // snap to the resolved (default/primary) one.
  useEffect(() => {
    if (!state) return;
    const valid = activeLocations(state).some(l => l.id === cur);
    if (!valid) {
      const fallback = resolveLocation(state, cur)?.id;
      if (fallback && fallback !== cur) setCurrentLocationId(fallback);
    }
  }, [state, cur]);

  if (!state || !isMultiLocation(state)) return null;
  const locs = activeLocations(state);

  return (
    <select
      value={cur}
      onChange={e => setCurrentLocationId(e.target.value)}
      title="Current location"
      style={{
        fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--pn-text)',
        background: 'var(--pn-bg)', border: '1px solid var(--pn-border-strong)',
        borderRadius: 8, padding: '6px 8px', maxWidth: 160, cursor: 'pointer', flexShrink: 0,
      }}
    >
      {locs.map(l => <option key={l.id} value={l.id}>{l.name || l.id}</option>)}
    </select>
  );
}
