import { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { chatWithReports } from '../lib/firestore';
import MarkdownLite from './MarkdownLite';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

const SUGGESTED = [
  'Revenue by tech for last month',
  'Top 10 clients by spend in the last 90 days',
  "Who hasn't visited in 60 days?",
  'How is this month vs last month?',
];

// Mobile port of the web Reports "Ask AI" tab. Sends the full message history
// to the chatWithReports callable (Haiku + read-only report tools) and renders
// markdown replies. Read-only — the assistant only queries, never writes.
export default function AskAIChat() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [messages, setMessages] = useState([]);
  const [input, setInput]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');
  const scrollRef = useRef(null);
  const toEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setError(''); setInput('');
    const next = [...messages, { role: 'user', content: q }];
    setMessages(next); setBusy(true); toEnd();
    try {
      const res = await chatWithReports(next);
      setMessages([...next, { role: 'assistant', content: res?.reply || 'No answer.' }]);
    } catch (e) {
      setError(e?.message || 'Could not reach the assistant.');
    } finally { setBusy(false); toEnd(); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={{ padding: 14, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        {messages.length === 0 && (
          <View style={styles.intro}>
            <Text style={styles.introTitle}>🤖 Ask anything about your data</Text>
            <Text style={styles.introSub}>Read-only — the assistant looks up appointments, revenue, clients and more. It never changes anything.</Text>
            {SUGGESTED.map(s => (
              <TouchableOpacity key={s} style={styles.suggest} onPress={() => send(s)}><Text style={styles.suggestText}>{s}</Text></TouchableOpacity>
            ))}
          </View>
        )}
        {messages.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.aiBubble]}>
            {m.role === 'user' ? <Text style={styles.userText}>{m.content}</Text> : <MarkdownLite text={m.content} />}
          </View>
        ))}
        {busy && <View style={styles.thinking}><ActivityIndicator color={theme.green} /><Text style={styles.thinkingText}>Thinking…</Text></View>}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.inputBar}>
        {messages.length > 0 && (
          <TouchableOpacity style={styles.resetBtn} onPress={() => { setMessages([]); setError(''); }}><Text style={styles.resetText}>Reset</Text></TouchableOpacity>
        )}
        <TextInput style={styles.input} value={input} onChangeText={setInput} placeholder="Ask a question…" placeholderTextColor={theme.placeholder} multiline />
        <TouchableOpacity style={[styles.sendBtn, (busy || !input.trim()) && { opacity: 0.5 }]} onPress={() => send()} disabled={busy || !input.trim()}>
          <Text style={styles.sendText}>Ask</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  scroll:      { flex: 1, backgroundColor: t.bg },
  intro:       { backgroundColor: t.surface, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: t.border },
  introTitle:  { fontSize: 18, fontWeight: '800', color: t.text },
  introSub:    { fontSize: 13, color: t.textMuted, marginTop: 6, lineHeight: 18, marginBottom: 6 },
  suggest:     { backgroundColor: t.surfaceAlt, borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: t.border },
  suggestText: { fontSize: 14, color: t.text, fontWeight: '600' },
  bubble:      { borderRadius: 16, padding: 14, marginTop: 10, maxWidth: '92%' },
  userBubble:  { backgroundColor: t.greenSoft, borderWidth: 1, borderColor: t.green, alignSelf: 'flex-end' },
  aiBubble:    { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, alignSelf: 'flex-start' },
  userText:    { fontSize: 15, color: t.text, lineHeight: 21 },
  thinking:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingLeft: 4 },
  thinkingText:{ fontSize: 14, color: t.textMuted },
  error:       { fontSize: 13, color: t.danger, marginTop: 12, backgroundColor: t.dangerSoft || 'transparent', padding: 8, borderRadius: 8 },
  inputBar:    { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.surface },
  resetBtn:    { paddingVertical: 12, paddingHorizontal: 8 },
  resetText:   { fontSize: 13, color: t.textMuted, fontWeight: '700' },
  input:       { flex: 1, maxHeight: 120, backgroundColor: t.surfaceAlt, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  sendBtn:     { backgroundColor: t.green, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  sendText:    { color: '#fff', fontWeight: '800', fontSize: 15 },
});
