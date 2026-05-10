import { View, Text, StyleSheet, ScrollView } from 'react-native';

// Phase 4 will port src/modules/chat/ChatAdmin.jsx.
export default function ChatScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.icon}>💬</Text>
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.body}>
          Client conversations land here. You'll get a push when a client replies.
        </Text>
        <View style={styles.tag}>
          <Text style={styles.tagText}>Coming soon</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  content:   { padding: 20, paddingTop: 40, alignItems: 'center' },
  card:      { backgroundColor: '#fff', borderRadius: 16, padding: 28, alignItems: 'center', maxWidth: 360, width: '100%' },
  icon:      { fontSize: 44, marginBottom: 12 },
  title:     { fontSize: 20, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  body:      { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  tag:       { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: '#eff6ff' },
  tagText:   { fontSize: 11, fontWeight: '600', color: '#1e40af' },
});
