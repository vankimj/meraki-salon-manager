import { useState } from 'react';

// 4-digit PIN keypad. Calls onSuccess() when the entered PIN matches correctPin.
// Used to gate access to sensitive sections (HR, Reports).
export default function PinModal({ correctPin, onSuccess, onClose }) {
  const [entered, setEntered] = useState('');
  const [shake,   setShake]   = useState(false);

  function press(digit) {
    if (entered.length >= 4) return;
    const next = entered + digit;
    setEntered(next);
    if (next.length === 4) {
      if (next === correctPin) {
        onSuccess();
      } else {
        setShake(true);
        setTimeout(() => { setShake(false); setEntered(''); }, 600);
      }
    }
  }

  function del() { setEntered(e => e.slice(0, -1)); }

  const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '28px 24px', width: 280, boxShadow: '0 20px 60px rgba(0,0,0,.3)', textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginBottom: 6 }}>Enter PIN</div>
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 20 }}>Required to access this section</div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginBottom: 24,
          animation: shake ? 'pinShake .5s' : 'none' }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: i < entered.length ? '#1a1a1a' : '#e0e0e0', transition: 'background .1s' }} />
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {KEYS.map((k, i) => k === '' ? (
            <div key={i} />
          ) : k === '⌫' ? (
            <button key={i} onClick={del}
              style={{ height: 56, borderRadius: 12, border: '1px solid #e8e8e8', background: '#fafafa', fontSize: 20, color: '#555', cursor: 'pointer', fontFamily: 'inherit' }}>
              {k}
            </button>
          ) : (
            <button key={i} onClick={() => press(k)}
              style={{ height: 56, borderRadius: 12, border: '1px solid #e8e8e8', background: '#fff', fontSize: 22, fontWeight: 600, color: '#1a1a1a', cursor: 'pointer', fontFamily: 'inherit' }}>
              {k}
            </button>
          ))}
        </div>

        <button onClick={onClose} style={{ marginTop: 16, fontSize: 12, color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancel
        </button>
      </div>
      <style>{`@keyframes pinShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
    </div>
  );
}
