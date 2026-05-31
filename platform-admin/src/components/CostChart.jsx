import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  Legend, CartesianGrid, BarChart, Bar,
} from 'recharts';
import { C, FONT, radius } from '../theme.js';
import { fmtUsd } from '../lib/cost.js';

// Stacked area chart: 5 cost components per day. Order matters — bottom
// of the stack is the most stable (TFN), top is the spikiest (AI).
const SERIES = [
  { key: 'tfn',   label: 'TFN rental', color: '#94a3b8' },
  { key: 'gcp',   label: 'GCP',        color: '#7c3aed' },
  { key: 'email', label: 'Email',      color: '#3d9e8a' },
  { key: 'sms',   label: 'SMS',        color: '#3d95ce' },
  { key: 'ai',    label: 'AI',         color: '#c19a4a' },
];

export function CostAreaChart({ data, height = 240 }) {
  if (!data || data.length === 0) {
    return <ChartEmpty>No usage data yet. The nightly aggregator writes the first daily rollup at 03:00 UTC.</ChartEmpty>;
  }
  // If every day is zero, show a message instead of a flat empty axis.
  const hasAny = data.some(d => d.total > 0);
  if (!hasAny) {
    return <ChartEmpty>Aggregator has run but no paid events yet. Charts will populate as SMS / email / AI activity logs roll up.</ChartEmpty>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.ruleSoft} vertical={false} />
        <XAxis
          dataKey="label"
          stroke={C.mutedSoft}
          tick={{ fontSize: 11, fontFamily: FONT.body, fill: C.muted }}
          axisLine={{ stroke: C.rule }}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          stroke={C.mutedSoft}
          tick={{ fontSize: 11, fontFamily: FONT.body, fill: C.muted }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtUsd}
          width={56}
        />
        <Tooltip content={<CostTooltip />} />
        <Legend
          iconType="circle"
          wrapperStyle={{ fontFamily: FONT.body, fontSize: 11, paddingTop: 6 }}
        />
        {SERIES.map(s => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stackId="1"
            stroke={s.color}
            fill={s.color}
            fillOpacity={0.65}
            strokeWidth={1}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Horizontal bar chart for ranking tenants by MTD cost.
export function TenantCostBars({ rows, height = null, maxRows = 12 }) {
  if (!rows || rows.length === 0) {
    return <ChartEmpty>No tenants yet.</ChartEmpty>;
  }
  const shown = rows.slice(0, maxRows);
  const h = height || Math.max(120, 24 + shown.length * 28);
  const max = Math.max(...shown.map(r => r.totalCostUsd), 0.0001);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart
        data={shown}
        layout="vertical"
        margin={{ top: 4, right: 32, left: 8, bottom: 4 }}
      >
        <CartesianGrid stroke={C.ruleSoft} horizontal={false} />
        <XAxis
          type="number"
          stroke={C.mutedSoft}
          tick={{ fontSize: 11, fontFamily: FONT.body, fill: C.muted }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtUsd}
          domain={[0, max * 1.1]}
        />
        <YAxis
          type="category"
          dataKey="name"
          stroke={C.mutedSoft}
          tick={{ fontSize: 11, fontFamily: FONT.body, fill: C.text }}
          axisLine={false}
          tickLine={false}
          width={140}
        />
        <Tooltip content={<TenantBarTooltip />} cursor={{ fill: C.ruleSoft }} />
        <Bar
          dataKey="totalCostUsd"
          name="MTD cost"
          fill={C.plum}
          radius={[0, 6, 6, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function CostTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((a, p) => a + (p.value || 0), 0);
  // recharts gives series in stack order top-to-bottom; reverse for visual match
  const lines = [...payload].reverse().filter(p => p.value > 0);
  return (
    <div style={{
      background: '#fff', border: `1px solid ${C.rule}`, borderRadius: 8,
      padding: '10px 12px', boxShadow: '0 4px 14px rgba(15,25,35,.10)',
      fontFamily: FONT.body, fontSize: 12, color: C.text, minWidth: 160,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: C.ink }}>{label}</div>
      {lines.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, lineHeight: 1.7 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
            {p.name}
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: C.muted }}>{fmtUsd(p.value)}</span>
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${C.ruleSoft}`, marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: C.ink }}>
        <span>Total</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(total)}</span>
      </div>
    </div>
  );
}

function TenantBarTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const b = row.breakdown;
  return (
    <div style={{
      background: '#fff', border: `1px solid ${C.rule}`, borderRadius: 8,
      padding: '10px 12px', boxShadow: '0 4px 14px rgba(15,25,35,.10)',
      fontFamily: FONT.body, fontSize: 12, color: C.text, minWidth: 200,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: C.ink }}>{row.name}</div>
      <div style={{ fontSize: 10, color: C.mutedSoft, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>{row.plan} plan</div>
      {b ? (
        <>
          {[
            ['SMS',   b.sms,   '#3d95ce'],
            ['Email', b.email, '#3d9e8a'],
            ['AI',    b.ai,    '#c19a4a'],
            ['TFN',   b.tfn,   '#94a3b8'],
            ['GCP',   b.gcp,   '#7c3aed'],
          ].map(([label, v, color]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, lineHeight: 1.6 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                {label}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: C.muted }}>{fmtUsd(v)}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${C.ruleSoft}`, marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: C.ink }}>
            <span>MTD total</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(row.totalCostUsd)}</span>
          </div>
        </>
      ) : (
        <div style={{ color: C.mutedSoft, fontStyle: 'italic' }}>No rollup yet for this month.</div>
      )}
    </div>
  );
}

function ChartEmpty({ children }) {
  return (
    <div style={{
      padding: 32, textAlign: 'center', color: C.mutedSoft, fontSize: 12,
      fontStyle: 'italic', lineHeight: 1.55,
    }}>{children}</div>
  );
}

// MTD breakdown card — a single-month summary with per-component lines.
export function CostBreakdownCard({ monthly }) {
  if (!monthly) {
    return (
      <div style={{
        background: C.bgCode, border: `1px dashed ${C.rule}`, borderRadius: radius.md,
        padding: 16, fontSize: 12, color: C.muted, lineHeight: 1.55,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.mutedSoft, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>This month</div>
        <div style={{ fontStyle: 'italic' }}>No rollup yet. Aggregator runs nightly at 03:00 UTC.</div>
      </div>
    );
  }
  const rows = [
    ['SMS',   monthly.sms?.costUsd   || 0, `${monthly.sms?.sends || 0} sends · ${monthly.sms?.segments || 0} segments`, '#3d95ce'],
    ['Email', monthly.email?.costUsd || 0, `${monthly.email?.sends || 0} sends`,                                       '#3d9e8a'],
    ['AI',    monthly.ai?.costUsd    || 0, `${monthly.ai?.calls   || 0} calls · ${kFmt(monthly.ai?.inputTokens || 0)} in / ${kFmt(monthly.ai?.outputTokens || 0)} out`, '#c19a4a'],
    ['TFN',   monthly.tfn?.costUsd   || 0, `${monthly.tfn?.count  || 0} TFN-days`,                                     '#94a3b8'],
    ['GCP',   monthly.gcp?.costUsd   || 0, 'allocated by activity share',                                              '#7c3aed'],
  ];
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.rule}`, borderRadius: radius.md,
      padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.mutedSoft, textTransform: 'uppercase', letterSpacing: '.05em' }}>This month ({monthly.monthKey})</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(monthly.totalCostUsd)}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>
          {rows.map(([label, cost, sub, color]) => (
            <tr key={label} style={{ borderTop: `1px solid ${C.ruleSoft}` }}>
              <td style={{ padding: '8px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
                <span style={{ fontWeight: 600, color: C.text }}>{label}</span>
              </td>
              <td style={{ padding: '8px 0', color: C.muted, fontSize: 11 }}>{sub}</td>
              <td style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.ink, fontWeight: 600 }}>{fmtUsd(cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 10, fontSize: 10, color: C.mutedSoft, lineHeight: 1.5 }}>
        Day count: {monthly.dayCount || 0}. Updated {monthly.aggregatedAt ? new Date(monthly.aggregatedAt).toLocaleString() : 'never'}.
      </div>
    </div>
  );
}

function kFmt(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
