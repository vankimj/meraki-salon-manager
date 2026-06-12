import { View, Text, StyleSheet } from 'react-native';
import useCurrentTenantName from '../hooks/useCurrentTenantName';
import { useThemedStyles } from '../theme/ThemeContext';
import { BUILD_LABEL } from '../lib/version';

// Two-line header title: screen name on top, current salon name below, plus a
// tiny build label (mirrors the web app's BUILD_LABEL) so the live JS bundle is
// always identifiable at a glance. Used in RootNav's screenOptions.
export default function HeaderTitle({ title }) {
  const styles = useThemedStyles(makeStyles);
  const salon = useCurrentTenantName();
  return (
    <View style={styles.wrap}>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {salon && <Text style={styles.salon} numberOfLines={1}>{salon}</Text>}
      <Text style={styles.build} numberOfLines={1}>{BUILD_LABEL}</Text>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:  { alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: t.green },
  salon: { fontSize: 11, fontWeight: '500', color: t.textMuted, marginTop: 1 },
  build: { fontSize: 9, fontWeight: '500', color: t.textFaint || t.textMuted, marginTop: 1 },
});
