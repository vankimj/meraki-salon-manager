import { View, Text, StyleSheet } from 'react-native';
import useCurrentTenantName from '../hooks/useCurrentTenantName';

// Two-line header title: screen name on top, current salon name below.
// Used in RootNav's screenOptions so every tab's header makes the
// active tenant unmistakable — important now that mobile supports
// multi-tenant switching from Profile.
export default function HeaderTitle({ title }) {
  const salon = useCurrentTenantName();
  return (
    <View style={styles.wrap}>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {salon && <Text style={styles.salon} numberOfLines={1}>{salon}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:  { alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: '#2D7A5F' },
  salon: { fontSize: 11, fontWeight: '500', color: '#888', marginTop: 1 },
});
