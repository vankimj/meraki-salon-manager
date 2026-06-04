import { View, Text, StyleSheet } from 'react-native';
import Icon from '../../components/Icon';
import { moduleMeta } from '../../lib/modules';

// Shown for modules whose native screen isn't built yet. The tile is
// still visible (so the Manage grid mirrors /manage in full) but tapping
// it lands here instead of a dead end.
export default function ModulePlaceholder({ route }) {
  const { id, label, desc } = route.params || {};
  const meta = moduleMeta(id);
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Icon name={meta.icon} size={34} color="#2D7A5F" />
      </View>
      <Text style={styles.title}>{label}</Text>
      {!!desc && <Text style={styles.desc}>{desc}</Text>}
      <View style={styles.pill}><Text style={styles.pillText}>Coming soon to mobile</Text></View>
      <Text style={styles.note}>This module is available on the web app today and is being brought to mobile.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa', padding: 32 },
  iconWrap: { width: 72, height: 72, borderRadius: 20, backgroundColor: '#eef5f2', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title:    { fontSize: 22, fontWeight: '700', color: '#1a1a1a' },
  desc:     { fontSize: 13, color: '#8a8a8a', marginTop: 6, textAlign: 'center' },
  pill:     { marginTop: 18, backgroundColor: '#fdf2e6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { fontSize: 12, fontWeight: '700', color: '#c47d2e' },
  note:     { fontSize: 12, color: '#aaa', marginTop: 16, textAlign: 'center', lineHeight: 18, maxWidth: 260 },
});
