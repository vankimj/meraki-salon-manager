import { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { subscribeToChats } from '../lib/firestore';
import Icon from '../components/Icon';

function fmtRelative(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60)        return 'just now';
  if (diffSec < 3600)      return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400)     return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

export default function ChatScreen({ navigation }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeToChats((list) => {
      setThreads(list);
      setLoading(false);
    });
    return unsub;
  }, []);

  if (loading) {
    return <ActivityIndicator style={{ marginTop: 60 }} color="#3D95CE" />;
  }

  if (threads.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Icon name="chat" size={56} color="#cbd0d6" strokeWidth={1.5} />
        <Text style={[styles.emptyTitle, { marginTop: 14 }]}>No messages yet</Text>
        <Text style={styles.emptyBody}>
          Client conversations show up here. You'll get a push when a client replies.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={threads}
      keyExtractor={t => t.id}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      renderItem={({ item: t }) => (
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ChatThread', {
            clientId: t.clientId || t.id,
            clientName: t.clientName,
            clientEmail: t.clientEmail,
          })}
        >
          <View style={[styles.avatar, t.unreadStaff > 0 && styles.avatarUnread]}>
            <Text style={[styles.avatarInitial, t.unreadStaff > 0 && { color: '#fff' }]}>
              {(t.clientName || '?')[0].toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.rowTop}>
              <Text style={[styles.name, t.unreadStaff > 0 && styles.nameUnread]} numberOfLines={1}>
                {t.clientName || 'Unknown client'}
              </Text>
              <Text style={styles.time}>{fmtRelative(t.lastAt)}</Text>
            </View>
            <Text
              style={[styles.preview, t.unreadStaff > 0 && styles.previewUnread]}
              numberOfLines={1}
            >
              {t.lastMessage || 'No messages yet'}
            </Text>
          </View>
          {t.unreadStaff > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{t.unreadStaff > 9 ? '9+' : t.unreadStaff}</Text>
            </View>
          )}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#fff' },
  sep:       { height: 1, backgroundColor: '#f0f0f0', marginLeft: 70 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 16, gap: 12,
    backgroundColor: '#fff',
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e8f4f0', alignItems: 'center', justifyContent: 'center' },
  avatarUnread: { backgroundColor: '#3D95CE' },
  avatarInitial: { fontSize: 16, fontWeight: '700', color: '#2D7A5F' },
  rowTop:        { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name:          { fontSize: 14, fontWeight: '600', color: '#1a1a1a', flex: 1 },
  nameUnread:    { fontWeight: '700' },
  time:          { fontSize: 11, color: '#aaa' },
  preview:       { fontSize: 12, color: '#888', marginTop: 3 },
  previewUnread: { color: '#1a1a1a', fontWeight: '500' },
  unreadBadge:   { backgroundColor: '#ef4444', borderRadius: 10, minWidth: 20, paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center' },
  unreadBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  emptyState: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyIcon:  { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  emptyBody:  { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 19 },
});
