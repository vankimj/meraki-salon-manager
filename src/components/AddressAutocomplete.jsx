import { useState, useRef, useEffect } from 'react';
import { callFn } from '../lib/firebase';

// Address typeahead backed by Google Places API (server-side proxy via
// `placesAutocomplete` + `placeDetails` Cloud Functions — keeps the
// Maps API key off the browser).
//
// Usage:
//   <AddressAutocomplete
//     value={street}
//     onChange={setStreet}
//     onPlaceSelected={({ street, city, state, zip }) => {
//       setStreet(street); setCity(city); setState(state); setZip(zip);
//     }}
//     style={inp}
//     placeholder="Street address"
//   />
//
// Debounces by 300ms. Min 3 chars before querying. Dropdown closes on
// outside click. If Maps API isn't configured server-side, the
// component silently degrades to a plain input (the user can still
// type the address by hand).
export default function AddressAutocomplete({ value, onChange, onPlaceSelected, ...inputProps }) {
  const [predictions, setPredictions] = useState([]);
  const [open,        setOpen]        = useState(false);
  const [loading,     setLoading]     = useState(false);
  const timer = useRef(null);
  const wrap  = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function handleType(e) {
    const v = e.target.value;
    onChange?.(v);
    clearTimeout(timer.current);
    if (v.trim().length < 3) {
      setPredictions([]);
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await callFn('placesAutocomplete')({ input: v });
        setPredictions(res?.data?.predictions || []);
      } catch (_) {
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  async function pickPrediction(p) {
    setOpen(false);
    setPredictions([]);
    try {
      const res = await callFn('placeDetails')({ placeId: p.placeId });
      if (res?.data) onPlaceSelected?.(res.data);
    } catch (_) {
      // Silent fail — user can still hand-fill the broken-out fields.
    }
  }

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <input
        {...inputProps}
        value={value}
        onChange={handleType}
        onFocus={() => predictions.length > 0 && setOpen(true)}
        autoComplete="off"
      />
      {open && (loading || predictions.length > 0) && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0,
          background: 'var(--pn-surface)', border: '1px solid var(--pn-border-strong)', borderRadius: 8,
          zIndex: 250, maxHeight: 240, overflowY: 'auto',
          boxShadow: '0 6px 20px rgba(0,0,0,.12)', fontFamily: 'inherit',
        }}>
          {loading && predictions.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--pn-text-muted)' }}>Searching…</div>
          ) : predictions.map(p => (
            <div
              key={p.placeId}
              onMouseDown={() => pickPrediction(p)}
              style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--pn-border)', color: 'var(--pn-text)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--pn-surface-alt)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              📍 {p.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
