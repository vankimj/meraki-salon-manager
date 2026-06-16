import { C, FONT, grad, shadow, radius } from '../theme.js';
import Section from './Section.jsx';

const ITEMS = [
  {
    eyebrow: 'Calendar',
    title: 'A schedule that thinks like a front desk.',
    body: 'Drag any block to reschedule. Recurring appointments stick to the right tech. Time-off blocks auto-reroute affected clients. Walk-ins drop into the next-available column the moment they walk in.',
    bullets: [
      'Drag-and-drop reschedule with conflict detection',
      'Recurring bookings (this · following · all)',
      'Smart walk-in management',
      'Per-tech work-day blocks + global store hours',
      'Birthday banner + VIP highlight + check-in flow',
    ],
    visual: ScheduleVisual,
  },
  {
    eyebrow: 'Communications Hub',
    title: 'Every text, one threaded inbox.',
    body: 'Inbound texts auto-thread to the right client. Send confirmations, receipts, and marketing campaigns — by SMS or email — from the same surface your front desk works in. Per-client channel preferences so each client gets the channel they actually read.',
    bullets: [
      'Two-way SMS with auto-routed inbound',
      'Email confirmations, receipts & campaigns',
      'Per-client channel preferences (SMS / email)',
      'Delivery analytics on every send',
      'CAN-SPAM compliant + STOP keyword handling',
    ],
    visual: CommsVisual,
    reverse: true,
  },
  {
    eyebrow: 'Reporting + AI',
    title: 'Ask your salon a question.',
    body: 'A chatbot that knows your data — not a generic AI. "Who were my top three techs in March?" "Show me clients who haven\'t booked in 60 days." "What\'s my retention rate on first-time gel manis?" Real answers, in plain English, no SQL required. Read-only by design.',
    bullets: [
      'Read-only AI grounded in your salon\'s data',
      'Real-time financial breakdown + cancellation analysis',
      'Per-tech leaderboards (avg ticket, rebook rate, retention)',
      'IRS-ready tax export, fiscal-year reporting',
      'Method-bucket diagnostic on every receipt',
    ],
    visual: AIVisual,
  },
];

export default function Showcase() {
  return (
    <Section
      id="showcase"
      eyebrow="Built for the way you actually work"
      title="Three places we go deeper."
      subtitle="The modules every salon platform ships — and the depth we built into ours that you don't get anywhere else."
      alt
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 88 }}>
        {ITEMS.map(item => <ShowcaseItem key={item.title} {...item} />)}
      </div>
    </Section>
  );
}

function ShowcaseItem({ eyebrow, title, body, bullets, visual: Visual, reverse }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 64,
      alignItems: 'center',
    }} className="pn-showcase-row">
      <div style={{ order: reverse ? 2 : 1 }} className="pn-showcase-copy">
        <div style={{
          display: 'inline-block', padding: '4px 11px', borderRadius: 999,
          background: 'rgba(106,79,160,.08)',
          color: C.plum,
          fontSize: 11, fontWeight: 600, letterSpacing: '.08em',
          textTransform: 'uppercase', marginBottom: 14,
        }}>{eyebrow}</div>
        <h3 style={{
          fontFamily: FONT.display, fontSize: 'clamp(24px, 2.6vw, 32px)',
          lineHeight: 1.2, letterSpacing: '-.005em',
          margin: '0 0 16px', color: C.ink, fontWeight: 600,
        }}>{title}</h3>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: C.muted, margin: '0 0 22px' }}>{body}</p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {bullets.map(b => (
            <li key={b} style={{
              padding: '7px 0',
              borderTop: `1px solid ${C.ruleSoft}`,
              fontSize: 14, color: C.text,
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <span style={{ color: C.success, fontSize: 13, marginTop: 2 }}>✓</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div style={{ order: reverse ? 1 : 2, position: 'relative' }} className="pn-showcase-vis">
        <Visual />
      </div>
      <style>{`
        @media (max-width: 880px) {
          .pn-showcase-row { grid-template-columns: 1fr !important; gap: 32px !important; }
          .pn-showcase-copy { order: 1 !important; }
          .pn-showcase-vis  { order: 2 !important; }
        }
      `}</style>
    </div>
  );
}

function VisualCard({ children, label }) {
  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${C.rule}`,
      borderRadius: radius.lg,
      boxShadow: shadow.lg,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: `1px solid ${C.ruleSoft}`,
        display: 'flex', alignItems: 'center', gap: 10, background: '#fafafd',
      }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {['#ff5f57', '#ffbd2e', '#27c93f'].map(c => (
            <div key={c} style={{ width: 9, height: 9, borderRadius: '50%', background: c }} />
          ))}
        </div>
        <div style={{ marginLeft: 8, fontSize: 11, color: C.mutedSoft, fontWeight: 500 }}>{label}</div>
      </div>
      {children}
    </div>
  );
}

function ScheduleVisual() {
  // High-fidelity drag-to-reschedule preview — shows a block being dragged,
  // a target slot highlight, and the conflict-detection toast.
  const techs = [
    { name: 'Maya',   initials: 'MR', tint: '#e9e1f5', stroke: C.plum },
    { name: 'Riley',  initials: 'RK', tint: '#dceff1', stroke: C.teal },
    { name: 'Jordan', initials: 'JB', tint: '#fff1d6', stroke: C.gold },
  ];
  return (
    <VisualCard label="Calendar · Drag to reschedule">
      <div style={{ background: '#fcfbfd', minHeight: 320 }}>
        {/* Tech header */}
        <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(3, 1fr)', borderBottom: `1px solid ${C.ruleSoft}`, background: '#fff' }}>
          <div />
          {techs.map(t => (
            <div key={t.name} style={{ padding: '8px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: t.tint, color: t.stroke, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.initials}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.ink }}>{t.name}</div>
            </div>
          ))}
        </div>

        {/* Slots */}
        {[
          { t: '2:00', cells: [null,
            { svc: 'Gel Mani', cli: 'Emma K.', techIdx: 1 },
            null,
          ]},
          { t: '2:30', cells: [
            { svc: 'Pedicure', cli: 'Olivia P.', techIdx: 0 },
            { dragging: true, svc: 'Spa Pedi', cli: 'Sophia M.', techIdx: 1 },
            null,
          ]},
          { t: '3:00', cells: [null, null, { dropTarget: true }] },
          { t: '3:30', cells: [
            { svc: 'Fill', cli: 'Isabella R.', techIdx: 0 },
            null,
            { svc: 'Polish', cli: 'Mia W.', techIdx: 2 },
          ]},
        ].map((row, ri) => (
          <div key={ri} style={{ display: 'grid', gridTemplateColumns: '40px repeat(3, 1fr)', borderTop: `1px solid ${C.ruleSoft}` }}>
            <div style={{ padding: '10px 6px', fontSize: 10, color: C.mutedSoft, textAlign: 'right', background: '#fff' }}>{row.t}</div>
            {row.cells.map((cell, ci) => (
              <div key={ci} style={{
                padding: 4,
                borderLeft: `1px solid ${C.ruleSoft}`,
                minHeight: 44,
                background: cell?.dropTarget ? `${C.plum}15` : 'transparent',
                position: 'relative',
              }}>
                {cell?.dropTarget && (
                  <div style={{
                    position: 'absolute', inset: 4,
                    border: `2px dashed ${C.plum}`, borderRadius: 6,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, color: C.plum, fontWeight: 700,
                  }}>DROP HERE</div>
                )}
                {cell && !cell.dropTarget && (
                  <div style={{
                    background: techs[cell.techIdx].tint,
                    borderLeft: `3px solid ${techs[cell.techIdx].stroke}`,
                    padding: '5px 7px', borderRadius: 5,
                    fontSize: 10, lineHeight: 1.3,
                    opacity: cell.dragging ? 0.6 : 1,
                    transform: cell.dragging ? 'rotate(-2deg) translate(4px, 2px)' : 'none',
                    boxShadow: cell.dragging ? '0 6px 14px rgba(15,25,35,.18)' : 'none',
                    position: 'relative', zIndex: cell.dragging ? 5 : 1,
                  }}>
                    <div style={{ fontWeight: 700, color: techs[cell.techIdx].stroke }}>{cell.svc}</div>
                    <div style={{ color: C.muted, fontSize: 9 }}>{cell.cli}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

        {/* Hint chip */}
        <div style={{
          margin: '12px', padding: '8px 12px',
          background: '#fff', borderRadius: 10, border: `1px solid ${C.rule}`,
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, color: C.text, boxShadow: shadow.sm,
        }}>
          <span style={{ fontSize: 14 }}>✋</span>
          <span><strong>Dragging Spa Pedi → Jordan 3:00pm.</strong> No conflicts. Drop to confirm.</span>
        </div>
      </div>
    </VisualCard>
  );
}

function CommsVisual() {
  // Two-pane inbox + thread. Left rail shows clients with most-recent preview;
  // right pane is the active conversation.
  const inbox = [
    { name: 'Emma K.',     preview: 'Yes please 🙏',                                           when: '2m',  unread: 0, active: true,  ch: 'sms' },
    { name: 'Olivia P.',   preview: 'Thanks! See you Saturday',                                when: '14m', unread: 0, ch: 'email' },
    { name: 'Sophia M.',   preview: 'Can I bring my daughter for her first mani?',             when: '1h',  unread: 2, ch: 'sms' },
    { name: 'Isabella R.', preview: 'Hi! Just got your reminder for tomorrow',                 when: '3h',  unread: 0, ch: 'sms' },
    { name: 'Mia W.',      preview: 'Loved my visit. Can I post a review?',                    when: '1d',  unread: 0, ch: 'email' },
  ];
  const msgs = [
    { from: 'them', body: 'Hey! Can I move my Saturday appt to Sunday?', t: '2:14p', ch: 'sms' },
    { from: 'us',   body: 'Of course — Sunday at 11am with Riley works. Confirm?', t: '2:15p', ch: 'sms' },
    { from: 'them', body: 'Yes please 🙏', t: '2:16p', ch: 'sms' },
  ];
  return (
    <VisualCard label="Communications · Unified inbox">
      <div style={{ display: 'grid', gridTemplateColumns: '38% 1fr', minHeight: 360, background: '#fff' }}>
        {/* Inbox list */}
        <div style={{ borderRight: `1px solid ${C.ruleSoft}`, background: '#fcfbfd' }}>
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.ruleSoft}`, fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Inbox</span>
            <span style={{ background: C.plum, color: '#fff', padding: '1px 7px', borderRadius: 999, fontSize: 9 }}>2</span>
          </div>
          {inbox.map((c, i) => (
            <div key={i} style={{
              padding: '10px 12px',
              borderBottom: `1px solid ${C.ruleSoft}`,
              background: c.active ? `${C.plum}10` : 'transparent',
              borderLeft: c.active ? `3px solid ${C.plum}` : '3px solid transparent',
              cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: c.unread > 0 ? 700 : 600, color: C.ink, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {c.name}
                  <span style={{ fontSize: 8, padding: '1px 4px', background: c.ch === 'sms' ? `${C.plum}25` : `${C.blue}25`, color: c.ch === 'sms' ? C.plumDeep : C.blueDeep, borderRadius: 3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{c.ch}</span>
                </div>
                <span style={{ fontSize: 10, color: C.mutedSoft }}>{c.when}</span>
              </div>
              <div style={{ fontSize: 11, color: c.unread > 0 ? C.text : C.muted, marginTop: 3, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.preview}</span>
                {c.unread > 0 && <span style={{ background: C.plum, color: '#fff', minWidth: 16, height: 16, borderRadius: 8, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{c.unread}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Thread pane */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.ruleSoft}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg, #c4afe4, #8db9d8)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>SJ</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Emma K.</div>
              <div style={{ fontSize: 10, color: C.mutedSoft }}>Prefers SMS · Last visit 12 days ago</div>
            </div>
          </div>
          <div style={{ padding: 14, flex: 1, background: '#fafafd', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: m.from === 'us' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '78%',
                  padding: '7px 11px',
                  borderRadius: m.from === 'us' ? '13px 13px 4px 13px' : '13px 13px 13px 4px',
                  background: m.from === 'us' ? grad.primary : '#fff',
                  color: m.from === 'us' ? '#fff' : C.text,
                  border: m.from === 'us' ? 'none' : `1px solid ${C.rule}`,
                  fontSize: 12, lineHeight: 1.4,
                  boxShadow: m.from === 'us' ? 'none' : shadow.sm,
                }}>
                  <div>{m.body}</div>
                  <div style={{ fontSize: 9, marginTop: 3, opacity: .65 }}>{m.t}</div>
                </div>
              </div>
            ))}
          </div>
          {/* Quick-reply suggestions */}
          <div style={{ padding: '6px 12px', borderTop: `1px solid ${C.ruleSoft}`, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, color: C.mutedSoft, fontWeight: 600, alignSelf: 'center', textTransform: 'uppercase', letterSpacing: '.05em' }}>AI replies:</span>
            <span style={{ fontSize: 10, padding: '3px 8px', background: `${C.plum}10`, color: C.plumDeep, borderRadius: 999, border: `1px solid ${C.plum}25`, fontWeight: 500 }}>"Booked! See you Sunday."</span>
            <span style={{ fontSize: 10, padding: '3px 8px', background: `${C.plum}10`, color: C.plumDeep, borderRadius: 999, border: `1px solid ${C.plum}25`, fontWeight: 500 }}>"Confirmed for 11am."</span>
          </div>
          <div style={{ padding: 10, borderTop: `1px solid ${C.ruleSoft}`, display: 'flex', gap: 6, alignItems: 'center', background: '#fff' }}>
            <input type="text" placeholder="Reply..." readOnly style={{ flex: 1, padding: '7px 10px', fontSize: 11, border: `1px solid ${C.rule}`, borderRadius: 999, background: '#fafafa', outline: 'none' }} />
            <span style={{ fontSize: 9, padding: '3px 7px', background: `${C.plum}14`, color: C.plum, fontWeight: 700, borderRadius: 4 }}>SMS</span>
          </div>
        </div>
      </div>
    </VisualCard>
  );
}

function AIVisual() {
  // Reports module with sidebar tabs + active "Ask AI" pane. Conversation has
  // multiple turns to show the back-and-forth and a small bar-chart visualization
  // in the response.
  const tabs = [
    { label: 'Overview',    icon: '📊' },
    { label: 'Transactions', icon: '💳' },
    { label: 'IRS / Tax',    icon: '📋' },
    { label: 'Ask AI',       icon: '✨', active: true },
  ];
  return (
    <VisualCard label="Reports · Ask your salon a question">
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', minHeight: 360, background: '#fff' }}>
        {/* Sidebar */}
        <div style={{ borderRight: `1px solid ${C.ruleSoft}`, background: '#fcfbfd', padding: '12px 0' }}>
          {tabs.map(t => (
            <div key={t.label} style={{
              padding: '9px 14px',
              fontSize: 11, fontWeight: t.active ? 700 : 500,
              color: t.active ? C.plum : C.muted,
              background: t.active ? `${C.plum}10` : 'transparent',
              borderLeft: t.active ? `3px solid ${C.plum}` : '3px solid transparent',
              display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
            }}>
              <span style={{ fontSize: 13 }}>{t.icon}</span>
              <span>{t.label}</span>
            </div>
          ))}

          {/* Date range chip */}
          <div style={{ margin: '14px 12px 0', padding: '8px 10px', background: '#fff', borderRadius: 8, border: `1px solid ${C.rule}`, fontSize: 10, color: C.muted, lineHeight: 1.4 }}>
            <div style={{ fontWeight: 600, color: C.ink, marginBottom: 2 }}>Last 30 days</div>
            <div style={{ fontSize: 9 }}>Apr 8 – May 8, 2026</div>
          </div>
        </div>

        {/* Conversation pane */}
        <div style={{ padding: 16, background: '#fafafd', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* User bubble */}
          <Bubble side="user">Who were my top 3 techs by revenue this month?</Bubble>

          {/* AI bubble with bar chart */}
          <Bubble side="ai" duration="1.2s">
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: C.mutedSoft, borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 600 }}>Tech</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Revenue</th>
                  <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 600 }}>Tickets</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { tech: 'Maya R.',   $: 12840, n: 184, pct: 100 },
                  { tech: 'Riley K.',  $: 11290, n: 167, pct: 88  },
                  { tech: 'Jordan B.', $: 10750, n: 152, pct: 84  },
                ].map(r => (
                  <tr key={r.tech} style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                    <td style={{ padding: '6px 0', fontWeight: 600, color: C.ink }}>{r.tech}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: `${r.pct * 0.6}%`, height: 5, background: C.plum, borderRadius: 3 }} />
                        <span style={{ color: C.success, fontWeight: 600, fontSize: 10 }}>${r.$.toLocaleString()}</span>
                      </div>
                    </td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: C.muted, fontSize: 10 }}>{r.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
              Maya led on volume <em>and</em> ticket size — her avg ticket was <strong style={{ color: C.ink }}>$69.78</strong> vs the salon average of $58.40.
            </div>
          </Bubble>

          {/* User follow-up */}
          <Bubble side="user">How many of her clients booked again within 30 days?</Bubble>

          {/* AI follow-up — partial typing */}
          <Bubble side="ai" duration="0.9s">
            <strong style={{ color: C.ink }}>147 of 184</strong> (80%). That's 12 points above the salon-wide rebook rate.
          </Bubble>
        </div>
      </div>
    </VisualCard>
  );
}

function Bubble({ side, duration, children }) {
  const isUser = side === 'user';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
    }}>
      <div style={{
        maxWidth: isUser ? '78%' : '92%',
        padding: '10px 13px',
        borderRadius: isUser ? '13px 13px 4px 13px' : '13px 13px 13px 4px',
        background: isUser ? `${C.plum}12` : '#fff',
        color: C.text,
        border: isUser ? `1px solid ${C.plum}25` : `1px solid ${C.rule}`,
        fontSize: 12, lineHeight: 1.5,
        boxShadow: isUser ? 'none' : shadow.sm,
      }}>
        {!isUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 10, color: C.plum, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>
            ✨ Plume AI {duration && <span style={{ color: C.mutedSoft, fontWeight: 500 }}>· {duration}</span>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
