import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import {
  submitSupportTicket, chatWithSalonAdmin, submitOwnerReply,
  fetchRecentTickets, fetchTicket, subscribeToReplies,
} from '../lib/support';

// Mobile "Help & Support" — mirrors the web SupportTicketsButton: submit a
// ticket to the Plume team, chat with the AI assistant, and review/reply to
// open tickets. Reuses the same Cloud Functions as web.

const fmtWhen = (v) => {
  try {
    const d = v?.toDate ? v.toDate() : (v ? new Date(v) : null);
    return d ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  } catch { return ''; }
};

export default function HelpScreen() {
  const { theme } = useTheme();
  const [mode, setMode] = useState('ai'); // 'ai' | 'ticket' | 'tickets'
  const [openTicket, setOpenTicket] = useState(null);

  const seg = (id, label) => {
    const on = mode === id;
    return (
      <TouchableOpacity key={id} onPress={() => { setMode(id); setOpenTicket(null); }}
        style={{ flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center', backgroundColor: on ? theme.blue : theme.surfaceMuted }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: on ? '#fff' : theme.textMuted }}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
        {seg('ai', '✨ Ask AI')}
        {seg('ticket', '📨 New ticket')}
        {seg('tickets', '📋 My tickets')}
      </View>
      {mode === 'ai' && <AiChat theme={theme} />}
      {mode === 'ticket' && <TicketForm theme={theme} onFiled={() => setMode('tickets')} />}
      {mode === 'tickets' && (openTicket
        ? <TicketThread theme={theme} ticket={openTicket} onBack={() => setOpenTicket(null)} />
        : <TicketsList theme={theme} onOpen={setOpenTicket} />)}
    </KeyboardAvoidingView>
  );
}

function AiChat({ theme }) {
  const [sessionId] = useState(() => `m_${Date.now()}`);
  const [messages, setMessages] = useState([]); // {role:'user'|'assistant', content, actions?}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next); setInput(''); setBusy(true);
    try {
      const res = await chatWithSalonAdmin({ sessionId, messages: next.map(m => ({ role: m.role, content: m.content })) });
      setMessages(m => [...m, { role: 'assistant', content: res?.reply || res?.text || 'Sorry, I couldn’t answer that.', actions: res?.actions || [] }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: 'Something went wrong reaching the assistant. Try a ticket instead.' }]);
    } finally {
      setBusy(false);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 80);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 10 }}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}>
        {messages.length === 0 && (
          <Text style={{ fontSize: 13, color: theme.textMuted, lineHeight: 20, textAlign: 'center', marginTop: 24 }}>
            Ask anything about running the salon — schedule, checkout, settings, reports. The assistant answers from your salon’s data.
          </Text>
        )}
        {messages.map((m, i) => (
          <View key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%',
            backgroundColor: m.role === 'user' ? theme.blue : theme.surface, borderRadius: 14, padding: 11,
            borderWidth: m.role === 'user' ? 0 : 1, borderColor: theme.border }}>
            <Text style={{ fontSize: 14, color: m.role === 'user' ? '#fff' : theme.text, lineHeight: 20 }}>{m.content}</Text>
            {Array.isArray(m.actions) && m.actions.length > 0 && (
              <View style={{ marginTop: 6, gap: 4 }}>
                {m.actions.map((a, j) => (
                  <Text key={j} style={{ fontSize: 11, color: theme.textMuted, fontStyle: 'italic' }}>
                    ↳ {a.label || a.type || 'action'} (open on web to apply)
                  </Text>
                ))}
              </View>
            )}
          </View>
        ))}
        {busy && <ActivityIndicator color={theme.blue} style={{ alignSelf: 'flex-start', marginLeft: 8 }} />}
      </ScrollView>
      <Composer theme={theme} value={input} onChange={setInput} onSend={send} busy={busy} placeholder="Ask the assistant…" />
    </View>
  );
}

function TicketForm({ theme, onFiled }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function file() {
    if (!subject.trim() || !body.trim() || busy) return;
    setBusy(true);
    try {
      await submitSupportTicket({ subject: subject.trim(), body: body.trim(), priority: urgent ? 'high' : 'low' });
      setDone(true); setSubject(''); setBody('');
      setTimeout(() => { setDone(false); onFiled?.(); }, 1400);
    } catch (e) {
      setDone(false);
    } finally { setBusy(false); }
  }

  const inp = { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, color: theme.text };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <Text style={{ fontSize: 13, color: theme.textMuted, lineHeight: 19 }}>
        Reaches the Plume Nexus support team. You’ll see replies under “My tickets”.
      </Text>
      <TextInput value={subject} onChangeText={setSubject} placeholder="Subject" placeholderTextColor={theme.textMuted} style={inp} />
      <TextInput value={body} onChangeText={setBody} placeholder="What’s going on?" placeholderTextColor={theme.textMuted}
        multiline style={[inp, { minHeight: 120, textAlignVertical: 'top' }]} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[['low', 'Normal'], ['high', 'Urgent']].map(([id, label]) => {
          const on = (id === 'high') === urgent;
          return (
            <TouchableOpacity key={id} onPress={() => setUrgent(id === 'high')}
              style={{ flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center', borderWidth: 1.5,
                borderColor: on ? theme.blue : theme.border, backgroundColor: on ? theme.surfaceMuted : 'transparent' }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: on ? theme.blue : theme.textMuted }}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TouchableOpacity onPress={file} disabled={busy || !subject.trim() || !body.trim()}
        style={{ backgroundColor: (busy || !subject.trim() || !body.trim()) ? theme.surfaceMuted : theme.green, borderRadius: 12, padding: 15, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{done ? '✓ Sent' : busy ? 'Sending…' : 'Submit ticket'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function TicketsList({ theme, onOpen }) {
  const [tickets, setTickets] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setTickets(await fetchRecentTickets(50)); } catch { setTickets([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (tickets == null) return <ActivityIndicator color={theme.blue} style={{ marginTop: 40 }} />;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.blue} />}>
      {tickets.length === 0 && <Text style={{ color: theme.textMuted, textAlign: 'center', marginTop: 40 }}>No tickets yet.</Text>}
      {tickets.map(t => (
        <TouchableOpacity key={t.id} onPress={() => onOpen(t)}
          style={{ backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 13 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: theme.text, flex: 1 }} numberOfLines={1}>{t.subject || '(no subject)'}</Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: t.status === 'closed' ? theme.textMuted : theme.green }}>
              {(t.status || 'open').toUpperCase()}
            </Text>
          </View>
          <Text style={{ fontSize: 12, color: theme.textMuted, marginTop: 3 }} numberOfLines={1}>{t.body || ''}</Text>
          <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 4 }}>{fmtWhen(t.lastReplyAt || t.createdAt)}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function TicketThread({ theme, ticket, onBack }) {
  const [full, setFull] = useState(ticket);
  const [replies, setReplies] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef(null);

  useEffect(() => {
    fetchTicket(ticket.id).then(t => t && setFull(t)).catch(() => {});
    const unsub = subscribeToReplies(ticket.id, setReplies);
    return unsub;
  }, [ticket.id]);

  async function reply() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await submitOwnerReply({ ticketId: ticket.id, body: text.trim() }); setText(''); }
    catch (e) {} finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity onPress={onBack} style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
        <Text style={{ color: theme.blue, fontSize: 14, fontWeight: '600' }}>‹ All tickets</Text>
      </TouchableOpacity>
      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 10 }}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}>
        <Text style={{ fontSize: 16, fontWeight: '800', color: theme.text }}>{full.subject || '(no subject)'}</Text>
        <View style={{ backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 12 }}>
          <Text style={{ fontSize: 14, color: theme.text, lineHeight: 20 }}>{full.body || ''}</Text>
          <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 6 }}>{fmtWhen(full.createdAt)}</Text>
        </View>
        {replies.map(r => {
          const mine = r.author === 'owner' || r.by === 'owner' || r.role === 'owner';
          return (
            <View key={r.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%',
              backgroundColor: mine ? theme.blue : theme.surface, borderRadius: 14, padding: 11, borderWidth: mine ? 0 : 1, borderColor: theme.border }}>
              <Text style={{ fontSize: 14, color: mine ? '#fff' : theme.text, lineHeight: 20 }}>{r.body || r.text || ''}</Text>
              <Text style={{ fontSize: 10, color: mine ? 'rgba(255,255,255,.7)' : theme.textMuted, marginTop: 4 }}>
                {mine ? 'You' : 'Plume support'} · {fmtWhen(r.at)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
      {full.status !== 'closed' && (
        <Composer theme={theme} value={text} onChange={setText} onSend={reply} busy={busy} placeholder="Reply…" />
      )}
    </View>
  );
}

function Composer({ theme, value, onChange, onSend, busy, placeholder }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.headerBg, alignItems: 'flex-end' }}>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={theme.textMuted}
        multiline style={{ flex: 1, maxHeight: 120, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: theme.text }} />
      <TouchableOpacity onPress={onSend} disabled={busy || !value.trim()}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: (busy || !value.trim()) ? theme.surfaceMuted : theme.green }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>↑</Text>
      </TouchableOpacity>
    </View>
  );
}
