// Tiny dependency-free trend chart (inline SVG — the codebase pins no chart
// library; recharts is reserved for the heavy Reports module). Renders a single
// metric's series over time with min/max guides and a hover-free dot per point.

export default function TrendChart({ points = [], color = '#6a4fa0', height = 120, unit = '', label = '' }) {
  const data = points.filter(p => p && p.y != null && Number.isFinite(Number(p.y))).map(p => ({ x: p.x, y: Number(p.y) }));
  if (data.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', padding: '16px 0' }}>No data yet for {label || 'this metric'}.</div>;
  }
  const W = 320, H = height, pad = { l: 34, r: 10, t: 12, b: 20 };
  const ys = data.map(d => d.y);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = maxY - minY || 1;
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const xAt = (i) => pad.l + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yAt = (v) => pad.t + innerH - ((v - minY) / span) * innerH;
  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(d.y).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${xAt(data.length - 1).toFixed(1)},${(pad.t + innerH).toFixed(1)} L${xAt(0).toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`;
  const first = data[0].y, last = data[data.length - 1].y;
  const delta = last - first;

  return (
    <div>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text)' }}>{label}</span>
          <span style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>
            {last}{unit}{data.length > 1 && (
              <span style={{ color: delta === 0 ? 'var(--pn-text-faint)' : delta > 0 ? '#dc2626' : '#16a34a', marginLeft: 6, fontWeight: 600 }}>
                {delta > 0 ? '▲' : delta < 0 ? '▼' : ''}{delta !== 0 ? Math.abs(delta).toFixed(1) + unit : ''}
              </span>
            )}
          </span>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        <defs>
          <linearGradient id={`g-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.18" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[maxY, minY].map((v, i) => (
          <g key={i}>
            <line x1={pad.l} y1={yAt(v)} x2={W - pad.r} y2={yAt(v)} stroke="var(--pn-border)" strokeDasharray="3 3" />
            <text x={pad.l - 5} y={yAt(v) + 3} textAnchor="end" fontSize="9" fill="var(--pn-text-faint)">{v}{unit}</text>
          </g>
        ))}
        <path d={areaPath} fill={`url(#g-${color.replace('#', '')})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <circle key={i} cx={xAt(i)} cy={yAt(d.y)} r="3" fill="#fff" stroke={color} strokeWidth="2" />
        ))}
        {data.map((d, i) => (
          (i === 0 || i === data.length - 1 || data.length <= 6) && (
            <text key={`x${i}`} x={xAt(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--pn-text-faint)">{d.x}</text>
          )
        ))}
      </svg>
    </div>
  );
}
