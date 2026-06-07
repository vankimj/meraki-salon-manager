import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import TechAvatar from './TechAvatar';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Per-tech tip entry for a multi-tech sale. One $ field per tech, labelled with
// their service revenue so the customer can tip each differently. `techRevenue`
// is { techName: revenue }; `values` is { techName: string }; onChange(tech,text).
// The default (no entry) is the revenue-proportional split done in buildTechSplit.
export default function TechTipInputs({ techRevenue, values, onChange, photoByTech = {} }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const total = Object.keys(techRevenue).reduce((s, t) => s + (Number(values[t]) || 0), 0);
  return (
    <View style={styles.wrap}>
      {Object.entries(techRevenue).map(([tech, rev]) => (
        <View key={tech || '—'} style={styles.row}>
          <TechAvatar name={tech} photo={photoByTech[tech]} size={34} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{tech || '—'}</Text>
            <Text style={styles.sub}>{money(rev)} in services</Text>
          </View>
          <View style={styles.inputWrap}>
            <Text style={styles.dollar}>$</Text>
            <TextInput
              style={styles.input}
              value={values[tech] || ''}
              onChangeText={(v) => onChange(tech, v)}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={theme.placeholder}
            />
          </View>
        </View>
      ))}
      <Text style={styles.total}>Total tip: {money(total)}</Text>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:     { marginTop: 8, gap: 8 },
  row:      { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: t.border },
  name:     { fontSize: 15, fontWeight: '700', color: t.text },
  sub:      { fontSize: 12, color: t.textMuted, marginTop: 2 },
  inputWrap:{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.surfaceAlt, borderRadius: 10, paddingHorizontal: 10, borderWidth: 1, borderColor: t.border, minWidth: 96 },
  dollar:   { fontSize: 16, color: t.textMuted },
  input:    { flex: 1, fontSize: 17, fontWeight: '800', color: t.text, paddingVertical: 9, marginLeft: 4, textAlign: 'right' },
  total:    { fontSize: 13, fontWeight: '700', color: t.textMuted, textAlign: 'right', marginTop: 2 },
});
