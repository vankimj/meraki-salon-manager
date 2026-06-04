import { View, Text, StyleSheet } from 'react-native';
import Icon from '../../components/Icon';
import { moduleMeta } from '../../lib/modules';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Shown for modules whose native screen isn't built yet. The tile is
// still visible (so the Manage grid mirrors /manage in full) but tapping
// it lands here instead of a dead end.
export default function ModulePlaceholder({ route }) {
  const { id, label, desc } = route.params || {};
  const meta = moduleMeta(id);
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Icon name={meta.icon} size={34} color={theme.green} />
      </View>
      <Text style={styles.title}>{label}</Text>
      {!!desc && <Text style={styles.desc}>{desc}</Text>}
      <View style={styles.pill}><Text style={styles.pillText}>Coming soon to mobile</Text></View>
      <Text style={styles.note}>This module is available on the web app today and is being brought to mobile.</Text>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg, padding: 32 },
  iconWrap: { width: 72, height: 72, borderRadius: 20, backgroundColor: t.greenSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title:    { fontSize: 22, fontWeight: '700', color: t.text },
  desc:     { fontSize: 13, color: t.textMuted, marginTop: 6, textAlign: 'center' },
  pill:     { marginTop: 18, backgroundColor: t.warningBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { fontSize: 12, fontWeight: '700', color: t.warning },
  note:     { fontSize: 12, color: t.textFaint, marginTop: 16, textAlign: 'center', lineHeight: 18, maxWidth: 260 },
});
