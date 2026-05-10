import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { auth } from '../lib/firebase';
import { subscribeToChat, sendChatMessage, markChatRead } from '../lib/firestore';
import Icon from '../components/Icon';

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function ChatThreadScreen({ route }) {
  const { clientId, clientName, clientEmail } = route.params || {};
  const [thread,  setThread]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [draft,   setDraft]   = useState('');
  const [sending, setSending] = useState(false);
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
      const me = auth.currentUser;
      const message = {
        from: 'staff',
        text,
        at:   new Date().toISOString(),
        sender: me?.displayName || me?.email || 'Staff',
      };
      await sendChatMessage(clientId, { name: clientName, email: clientEmail }, message);
      setDraft('');
    } catch (e) {
      console.warn('[chat] send failed:', e?.message);
    } finally {
      setSending(false);
    }
  }, [draft, sending, clientId, clientName, clientEmail]);

  if (loading) {
    return <ActivityIndicator style={{ marginTop: 60 }} color="#3D95CE" />;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#f5f7fa' }}
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
            <Icon name="chat" size={48} color="#cbd0d6" strokeWidth={1.5} />
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

      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          value={draft}
          onChangeText={setDraft}
          placeholder="Type a message…"
          placeholderTextColor="#bbb"
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

const styles = StyleSheet.create({
  emptyState:  { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyIcon:   { fontSize: 44, marginBottom: 10 },
  emptyTitle:  { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
  emptyBody:   { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 19 },

  bubbleRow:   { paddingHorizontal: 4 },
  bubble:      { maxWidth: '78%', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 16 },
  bubbleStaff: { backgroundColor: '#3D95CE' },
  bubbleClient:{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#ebebeb' },
  bubbleText:  { fontSize: 14, color: '#1a1a1a', lineHeight: 19 },
  bubbleTextStaff: { color: '#fff' },
  bubbleTime:  { fontSize: 10, color: '#aaa', marginTop: 3, marginHorizontal: 6 },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8, paddingBottom: Platform.OS === 'ios' ? 8 : 10,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#ebebeb',
  },
  composerInput: {
    flex: 1, backgroundColor: '#f5f5f5', borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#1a1a1a',
    maxHeight: 110,
  },
  sendBtn:     { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18, backgroundColor: '#2D7A5F' },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
