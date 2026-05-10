import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { auth } from '../lib/firebase';
import { clearPushTokenForUser } from '../hooks/usePushRegistration';

export default function ProfileScreen() {
  const user = auth.currentUser;
  const displayName = user?.displayName || user?.email || '';
  const firstName   = displayName.split(' ')[0];
  const photo       = user?.photoURL;

  async function handleSignOut() {
    try {
      await clearPushTokenForUser(user?.uid);
    } catch {}
    await auth.signOut();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Identity card */}
      <View style={styles.identity}>
        {photo
          ? <Image source={{ uri: photo }} style={styles.avatar} />
          : <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{(firstName[0] || '?').toUpperCase()}</Text>
            </View>
        }
        <Text style={styles.name}>{displayName}</Text>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      {/* Profile editing — Phase 3 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Edit profile</Text>
        <Text style={styles.cardBody}>
          Update your photo, contact info, and social handles. Compensation
          stays admin-only.
        </Text>
        <View style={styles.tag}>
          <Text style={styles.tagText}>Coming soon</Text>
        </View>
      </View>

      {/* Settings — Phase 4 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Settings</Text>
        <Text style={styles.cardBody}>
          Notification preferences, theme, auto-logout timer.
        </Text>
        <View style={styles.tag}>
          <Text style={styles.tagText}>Coming soon</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f5f7fa' },
  content:         { padding: 20 },
  identity:        { alignItems: 'center', paddingVertical: 28, marginBottom: 16 },
  avatar:          { width: 88, height: 88, borderRadius: 44, marginBottom: 12 },
  avatarFallback:  { backgroundColor: '#2D7A5F', alignItems: 'center', justifyContent: 'center' },
  avatarInitial:   { color: '#fff', fontSize: 36, fontWeight: '700' },
  name:            { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  email:           { fontSize: 13, color: '#888', marginTop: 4 },
  card:            { backgroundColor: '#fff', borderRadius: 14, padding: 18, marginBottom: 12 },
  cardTitle:       { fontSize: 14, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
  cardBody:        { fontSize: 13, color: '#666', lineHeight: 18, marginBottom: 12 },
  tag:             { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: '#eff6ff' },
  tagText:         { fontSize: 11, fontWeight: '600', color: '#1e40af' },
  signOutBtn:      { marginTop: 16, alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 30, borderRadius: 22, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  signOutText:     { color: '#ef4444', fontSize: 14, fontWeight: '600' },
});
