import { View, Text, StyleSheet } from 'react-native';
import useCurrentTenantName from '../hooks/useCurrentTenantName';
import { useThemedStyles } from '../theme/ThemeContext';

// Two-line header title: screen name on top, current salon name below.
// Used in RootNav's screenOptions so every tab's header makes the
// active tenant unmistakable — important now that mobile supports
// multi-tenant switching from Profile.
export default function HeaderTitle({ title }) {
  const styles = useThemedStyles(makeStyles);
  const salon = useCurrentTenantName();
  return (
    <View style={styles.wrap}>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {salon && <Text style={styles.salon} numberOfLines={1}>{salon}</Text>}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:  { alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: t.green },
  salon: { fontSize: 11, fontWeight: '500', color: t.textMuted, marginTop: 1 },
});
