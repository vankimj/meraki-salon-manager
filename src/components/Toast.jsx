import { useApp } from '../context/AppContext';

export default function Toast() {
  const { toast, toastAction } = useApp();
  return (
    <div style={{
      position: 'absolute', bottom: 70, left: '50%',
      transform: `translateX(-50%) translateY(${toast ? 0 : 20}px)`,
      background: 'rgba(0,0,0,.82)', color: '#fff', fontSize: 12,
      padding: '7px 12px 7px 16px', borderRadius: 20,
      opacity: toast ? 1 : 0,
      transition: 'opacity .3s, transform .3s',
      pointerEvents: toastAction ? 'auto' : 'none',
      whiteSpace: 'nowrap', zIndex: 400,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span>{toast}</span>
      {toastAction && (
        <button
          onClick={toastAction.fn}
          style={{
            background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff',
            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12,
            cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '.03em',
          }}>
          {toastAction.label}
        </button>
      )}
    </div>
  );
}
