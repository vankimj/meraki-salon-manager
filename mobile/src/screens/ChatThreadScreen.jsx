import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { auth } from '../lib/firebase';
import { subscribeToChat, sendChatMessage, sendSmsToClient, sendEmailToClient, markChatRead } from '../lib/firestore';
import Icon from '../components/Icon';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function ChatThreadScreen({ route }) {
  const { clientId, clientName, clientEmail } = route.params || {};
  const [thread,  setThread]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [draft,   setDraft]   = useState('');
  const [subject, setSubject] = useState('Message from your salon');  // email only
  const [sending, setSending] = useState(false);
  const [channel, setChannel] = useState('app');   // 'app' | 'sms' | 'email'
  const listRef = useRef(null);

  // Live subscription to the chat doc.
  useEffect(() => {
    if (!clientId) return;
    const unsub = subscribeToChat(clientId, (t) => {
      setThread(t);
      setLoading(false);
    });
    return unsub;
  }, [clientId]);

  // Mark-as-read whenever the screen has unread messages (entered the
  // thread or new client message arrived while open).
  useEffect(() => {
    if (thread?.unreadStaff > 0 && clientId) markChatRead(clientId);
  }, [thread?.unreadStaff, clientId]);

  // Auto-scroll to the newest message when count grows.
  const messages = thread?.messages || [];
  useEffect(() => {
    if (messages.length === 0) return;
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      if (channel === 'sms') {
        await sendSmsToClient(clientId, text);
      } else if (channel === 'email') {
        await sendEmailToClient(clientId, subject.trim() || 'Message from your salon', text);
      } else {
        const me = auth.currentUser;
        const message = {
          from: 'staff',
          text,
          at:   new Date().toISOString(),
          sender: me?.displayName || me?.email || 'Staff',
        };
        await sendChatMessage(clientId, { name: clientName, email: clientEmail }, message);
      }
      setDraft('');
    } catch (e) {
      console.warn('[chat] send failed:', e?.message);
    } finally {
      setSending(false);
    }
  }, [draft, sending, channel, subject, clientId, clientName, clientEmail]);

  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();

  if (loading) {
    return <ActivityIndicator style={{ marginTop: 60 }} color={theme.blue} />;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(_, i) => `${i}`}
        contentContainerStyle={{ padding: 12, gap: 6 }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Icon name="chat" size={48} color={theme.textFaint} strokeWidth={1.5} />
            <Text style={[styles.emptyTitle, { marginTop: 12 }]}>No messages yet</Text>
            <Text style={styles.emptyBody}>Send the first message — clients see them in their portal and can reply.</Text>
          </View>
        }
        renderItem={({ item: m, index }) => {
          const isStaff = m.from === 'staff';
          const showTime = index === messages.length - 1 || messages[index + 1]?.from !== m.from;
          return (
            <View style={[styles.bubbleRow, { alignItems: isStaff ? 'flex-end' : 'flex-start' }]}>
              <View style={[styles.bubble, isStaff ? styles.bubbleStaff : styles.bubbleClient]}>
                <Text style={[styles.bubbleText, isStaff && styles.bubbleTextStaff]}>{m.text}</Text>
              </View>
              {showTime && (
                <Text style={styles.bubbleTime}>{fmtTime(m.at)}</Text>
              )}
            </View>
          );
        }}
      />

      {/* Channel picker — App is always available; SMS / Email gate
          on whether the thread doc has the contact info on file. */}
      <View style={styles.channelRow}>
        {[
          { id: 'app',   label: '💬 App',  enabled: true },
          { id: 'sms',   label: '📱 SMS',  enabled: !!thread?.clientPhone },
          { id: 'email', label: '✉️ Email', enabled: !!(thread?.clientEmail || clientEmail) },
        ].map(c => (
          <TouchableOpacity
            key={c.id}
            disabled={!c.enabled}
            onPress={() => setChannel(c.id)}
            style={[
              styles.channelChip,
              channel === c.id && c.enabled && styles.channelChipActive,
              !c.enabled && styles.channelChipDisabled,
            ]}
          >
            <Text style={[
              styles.channelChipText,
              channel === c.id && c.enabled && styles.channelChipTextActive,
              !c.enabled && styles.channelChipTextDisabled,
            ]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {channel === 'email' && (
        <View style={styles.subjectWrap}>
          <TextInput
            style={styles.subjectInput}
            value={subject}
            onChangeText={setSubject}
            placeholder="Subject"
            placeholderTextColor={theme.placeholder}
            maxLength={200}
          />
        </View>
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          value={draft}
          onChangeText={setDraft}
          placeholder={
            channel === 'sms'   ? 'Send as SMS…'
            : channel === 'email' ? 'Email body…'
            : 'Type a message…'
          }
          placeholderTextColor={theme.placeholder}
          multiline
          maxLength={2000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]}
          onPress={handleSend}
          disabled={!draft.trim() || sending}
        >
          <Text style={styles.sendBtnText}>{sending ? '…' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  emptyState:  { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyIcon:   { fontSize: 44, marginBottom: 10 },
  emptyTitle:  { fontSize: 16, fontWeight: '700', color: t.text, marginBottom: 6 },
  emptyBody:   { fontSize: 13, color: t.textMuted, textAlign: 'center', lineHeight: 19 },

  bubbleRow:   { paddingHorizontal: 4 },
  bubble:      { maxWidth: '78%', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 16 },
  bubbleStaff: { backgroundColor: t.blue },
  bubbleClient:{ backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
  bubbleText:  { fontSize: 14, color: t.text, lineHeight: 19 },
  bubbleTextStaff: { color: '#fff' },
  bubbleTime:  { fontSize: 10, color: t.textFaint, marginTop: 3, marginHorizontal: 6 },

  channelRow: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4,
    backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.border,
  },
  channelChip:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: t.surfaceMuted, borderWidth: 1, borderColor: t.border },
  channelChipActive:  { backgroundColor: t.blueSoft, borderColor: t.blue },
  channelChipDisabled:{ opacity: 0.4 },
  channelChipText:        { fontSize: 12, fontWeight: '600', color: t.textMuted },
  channelChipTextActive:  { color: t.blue, fontWeight: '700' },
  channelChipTextDisabled:{ color: t.textFaint },
  subjectWrap:  { paddingHorizontal: 10, paddingTop: 4, paddingBottom: 4, backgroundColor: t.surface },
  subjectInput: { borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: t.text, backgroundColor: t.surfaceAlt },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8, paddingBottom: Platform.OS === 'ios' ? 8 : 10,
    backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.border,
  },
  composerInput: {
    flex: 1, backgroundColor: t.surfaceAlt, borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: t.text,
    maxHeight: 110,
  },
  sendBtn:     { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18, backgroundColor: t.green },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
