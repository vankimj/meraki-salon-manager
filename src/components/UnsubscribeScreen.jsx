import { useEffect, useState } from 'react';
import { callFn } from '../lib/firebase';

// Public unsubscribe page hit by the link in marketing emails. Reads
// tid/cid/t from the query string, calls processUnsubscribe to flag
// marketingOptOut: true on the client doc, and renders a confirmation
// (or error) banner. CAN-SPAM allows single-click unsubscribe; we don't
// require any further confirmation.
export default function UnsubscribeScreen() {
  const [state, setState] = useState({ status: 'working', message: '' });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tid   = params.get('tid');
    const cid   = params.get('cid');
    const token = params.get('t');
    if (!tid || !cid || !token) {
      setState({ status: 'error', message: 'This unsubscribe link is missing required parameters.' });
      return;
    }
    callFn('processUnsubscribe')({ tid, cid, token })
      .then(({ data }) => {
        setState({ status: 'ok', name: data?.name || null });
      })
      .catch((e) => {
        const msg = e?.message || 'Something went wrong.';
        setState({ status: 'error', message: msg });
      });
  }, []);

  const wrap = { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: '#f4f4f4', padding: 20, fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' };
  const card = { background: '#fff', borderRadius: 14, padding: '32px 28px', maxWidth: 460, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,.08)', textAlign: 'center' };

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', height: 6, borderRadius: 3, marginBottom: 22 }} />
        {state.status === 'working' && (
          <>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', marginBottom: 6 }}>Unsubscribing…</div>
            <div style={{ fontSize: 13, color: '#888' }}>Just a moment.</div>
          </>
        )}
        {state.status === 'ok' && (
          <>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✓</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#16a34a', marginBottom: 6 }}>You've been unsubscribed</div>
            <div style={{ fontSize: 13, color: '#666', lineHeight: 1.55 }}>
              {state.name ? `${state.name}, you'll` : "You'll"} no longer receive marketing emails or text messages from Meraki Nail Studio.
              <br /><br />
              Appointment confirmations and receipts will still be sent — those aren't marketing.
              <br /><br />
              Changed your mind? Contact the salon and we'll re-enroll you.
            </div>
          </>
        )}
        {state.status === 'error' && (
          <>
            <div style={{ fontSize: 36, marginBottom: 10 }}>⚠</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444', marginBottom: 6 }}>We couldn't process this unsubscribe</div>
            <div style={{ fontSize: 13, color: '#666', lineHeight: 1.55 }}>
              {state.message}
              <br /><br />
              The link may have expired, been corrupted, or already been used. If you keep receiving messages, please reply to one of our emails with the word "unsubscribe" and we'll handle it manually.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
