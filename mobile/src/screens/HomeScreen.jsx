import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Image } from 'react-native';
import { auth } from '../lib/firebase';
import { useThemedStyles } from '../theme/ThemeContext';

const TILES = [
  { id: 'Schedule', icon: '📅', color: '#3D95CE', desc: 'Daily appointments' },
  { id: 'Clients',  icon: '👤', color: '#2D7A5F', desc: 'Client profiles'    },
  { id: 'Services', icon: '✨', color: '#3D9E8A', desc: 'Service menu'        },
];

const makeStyles = (t) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  content: {
    padding: 20,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
  },
  welcomeText: {
    fontSize: 12,
    color: t.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  nameText: {
    fontSize: 24,
    fontWeight: '700',
    color: t.text,
    marginTop: 2,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  tile: {
    backgroundColor: t.surface,
    borderRadius: 14,
    padding: 18,
    width: '47%',
    borderTopWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  tileIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  tileTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: t.text,
  },
  tileDesc: {
    fontSize: 11,
    color: t.textMuted,
    marginTop: 3,
  },
  signOutBtn: {
    marginTop: 40,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 20,
    backgroundColor: t.dangerBg,
    borderWidth: 1,
    borderColor: t.danger,
  },
  signOutText: {
    color: t.danger,
    fontSize: 13,
    fontWeight: '600',
  },
});

export default function HomeScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const user = auth.currentUser;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.welcomeText}>Welcome back</Text>
          <Text style={styles.nameText}>{user?.displayName?.split(' ')[0] ?? 'Admin'}</Text>
        </View>
        {user?.photoURL && (
          <Image source={{ uri: user.photoURL }} style={styles.avatar} />
        )}
      </View>

      {/* Module tiles */}
      <View style={styles.grid}>
        {TILES.map(tile => (
          <TouchableOpacity
            key={tile.id}
            style={[styles.tile, { borderTopColor: tile.color }]}
            onPress={() => navigation.navigate(tile.id)}
            activeOpacity={0.8}
          >
            <Text style={styles.tileIcon}>{tile.icon}</Text>
            <Text style={styles.tileTitle}>{tile.id}</Text>
            <Text style={styles.tileDesc}>{tile.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Sign out */}
      <TouchableOpacity style={styles.signOutBtn} onPress={() => auth.signOut()}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
