import { useState, useEffect } from 'react';
import { getAppointmentById, markCheckedIn, fetchBookingConfig } from '../lib/firestore';

function fmtDate(str) {
  if (!str) return '';
  return new Date(str + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function fmtTime(str) {
  if (!str) return '';
  const [h, m] = str.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function CheckInScreen({ apptId }) {
  const [appt,        setAppt]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [done,        setDone]        = useState(false);
  const [working,     setWorking]     = useState(false);
  const [geoStatus,   setGeoStatus]   = useState('idle'); // idle | requesting | nearby | far | denied | unavailable
  const [geoDistance, setGeoDistance] = useState(null);

  useEffect(() => {
    Promise.all([
      getAppointmentById(apptId),
      fetchBookingConfig().catch(() => null),
    ]).then(([a, config]) => {
      if (!a) { setError('Appointment not found.'); }
      else {
        setAppt(a);
        if (a.checkedInAt) setDone(true);
      }
      setLoading(false);

      if (config?.geoEnabled && config.salonLat && config.salonLng) {
        if (!navigator.geolocation) { setGeoStatus('unavailable'); return; }
        setGeoStatus('requesting');
        navigator.geolocation.getCurrentPosition(
          pos => {
            const dist = distanceMeters(
              pos.coords.latitude, pos.coords.longitude,
              config.salonLat, config.salonLng
            );
            setGeoDistance(Math.round(dist));
            setGeoStatus(dist <= (config.checkinRadius || 200) ? 'nearby' : 'far');
          },
          () => setGeoStatus('denied'),
          { timeout: 10000, maximumAge: 60000 }
        );
      }
    }).catch(() => { setError('Could not load appointment.'); setLoading(false); });
  }, [apptId]); // eslint-disable-line

  async function handleCheckIn() {
    setWorking(true);
    try {
      await markCheckedIn(apptId);
      setDone(true);
    } catch {
      setError('Check-in failed. Please try again.');
      setWorking(false);
    }
  }

  const GEO_CFG = {
    requesting: { icon: '📍', text: 'Checking your location…',   bg: '#f8f9fa', color: '#888',    border: '#e8e8e8' },
    nearby:     { icon: '📍', text: 'You\'re at the salon ✓',    bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
    far:        { icon: '📍', text: geoDistance != null
                    ? `You appear to be ${geoDistance >= 1000 ? (geoDistance / 1000).toFixed(1) + ' km' : geoDistance + ' m'} away`
                    : 'You appear to be outside the salon',      bg: '#fffbeb', color: '#92400e', border: '#fde68a' },
    denied:     { icon: '📍', text: 'Location not shared',        bg: '#f8f9fa', color: '#aaa',    border: '#e8e8e8' },
  };
  const geoCfg = GEO_CFG[geoStatus];

  return (
    <div style={{ minHeight: '100dvh', background: 'linear-gradient(135deg,#0f1923 0%,#1a2940 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.4)' }}>

        <div style={{ background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', padding: '24px 24px 20px' }}>
          <div style={{ fontFamily: "'Great Vibes', cursive", fontSize: 34, color: '#fff', lineHeight: 1.1 }}>Meraki</div>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: 'rgba(255,255,255,.7)', letterSpacing: '.15em', marginTop: 2 }}>NAIL STUDIO</div>
        </div>

        <div style={{ padding: 24 }}>
          {loading && (
            <div style={{ textAlign: 'center', color: '#bbb', fontSize: 14, padding: 20 }}>Loading…</div>
          )}

          {error && !loading && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
              <div style={{ fontSize: 15, color: '#ef4444', fontWeight: 600, marginBottom: 8 }}>Something went wrong</div>
              <div style={{ fontSize: 13, color: '#888' }}>{error}</div>
            </div>
          )}

          {!loading && !error && appt && (
            done ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 52, marginBottom: 12 }}>✅</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#2D7A5F', marginBottom: 6 }}>You're checked in!</div>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 20, lineHeight: 1.6 }}>
                  We've let {appt.techName} know you're here. Please have a seat and we'll be right with you!
                </div>
                <div style={{ background: '#f0fdf4', borderRadius: 12, padding: '12px 16px', border: '1px solid #bbf7d0', textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#166534' }}>{appt.clientFirstName || 'Guest'}</div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{fmtDate(appt.date)} at {fmtTime(appt.startTime)}</div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>with {appt.techName}</div>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>
                  Welcome{appt.clientFirstName ? `, ${appt.clientFirstName}` : ''}!
                </div>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 16, lineHeight: 1.5 }}>
                  Confirm your appointment details and tap Check In below.
                </div>

                {/* Geo status badge */}
                {geoCfg && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: geoCfg.color, background: geoCfg.bg, border: `1px solid ${geoCfg.border}`, borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{geoCfg.icon}</span>
                    <span>{geoCfg.text}</span>
                    {geoStatus === 'requesting' && (
                      <span style={{ marginLeft: 4, display: 'inline-block', width: 12, height: 12, border: '2px solid #ccc', borderTopColor: '#888', borderRadius: '50%', animation: 'spin .7s linear infinite', flexShrink: 0 }} />
                    )}
                  </div>
                )}

                <div style={{ background: '#f8f9fa', borderRadius: 12, padding: '14px 16px', border: '1px solid #e8e8e8', marginBottom: 20 }}>
                  <InfoRow label="Date"     value={fmtDate(appt.date)} />
                  <InfoRow label="Time"     value={fmtTime(appt.startTime)} />
                  <InfoRow label="With"     value={appt.techName} />
                  {appt.services?.length > 0 && (
                    <InfoRow label="Services" value={appt.services.map(s => s.name).filter(Boolean).join(', ')} last />
                  )}
                </div>

                <button
                  onClick={handleCheckIn}
                  disabled={working}
                  style={{
                    width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                    background: working ? '#ccc' : 'linear-gradient(135deg,#2D7A5F,#3D95CE)',
                    color: '#fff', fontSize: 16, fontWeight: 700,
                    cursor: working ? 'default' : 'pointer',
                    fontFamily: 'inherit', letterSpacing: '.01em',
                  }}
                >
                  {working ? 'Checking in…' : 'Check In'}
                </button>
              </>
            )
          )}
        </div>

        <div style={{ padding: '10px 24px 18px', textAlign: 'center', borderTop: '1px solid #f5f5f5' }}>
          <div style={{ fontSize: 11, color: '#ccc' }}>Meraki Nail Studio · Columbus, OH</div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, last }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: last ? 0 : 8 }}>
      <span style={{ fontSize: 12, color: '#aaa', minWidth: 58, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: '#333', fontWeight: 500 }}>{value || '—'}</span>
    </div>
  );
}
