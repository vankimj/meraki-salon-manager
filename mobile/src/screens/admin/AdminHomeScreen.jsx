import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from '../../components/Icon';
import useTenantAccess from '../../hooks/useTenantAccess';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Mobile Admin home — the entry behind the Manage → Admin tile. Wave 1
// exposes Users (read), Settings (core), Activity Log, and the global
// Trash. Heavier web Admin tabs (Webfront, SMS, Onboarding, Demo Data,
// Integrity) are coming to mobile in later waves.
const ROWS = [
  { key: 'AdminUsers',     icon: 'people',    label: 'Users & Roles',  desc: 'Who has access and their role' },
  { key: 'AdminSettings',  icon: 'briefcase', label: 'Settings',       desc: 'Salon settings & preferences' },
  { key: 'AdminLogs',      icon: 'clock',     label: 'Activity Log',   desc: 'Recent admin actions' },
  { key: 'AdminFeedback',  icon: 'chat',      label: 'Feedback',       desc: 'Bug reports & ideas from staff' },
  { key: 'AdminNotifs',    icon: 'mail',      label: 'Notifications',  desc: 'Sent alerts & delivery status' },
  { key: 'AdminReviews',   icon: 'star',      label: 'Reviews',        desc: 'Google review requests & received' },
  { key: 'AdminOnboarding',icon: 'check',     label: 'Onboarding',     desc: 'Setup progress' },
  { key: 'AdminWebfront',  icon: 'pin',       label: 'Public Site',    desc: 'Business info shown to clients' },
  { key: 'AdminSms',       icon: 'phone',     label: 'SMS',            desc: 'Texting status & number' },
  { key: 'AdminIntegrity', icon: 'check',     label: 'Data Integrity', desc: 'Nightly data-health scan' },
  { key: 'AdminDemo',      icon: 'box',       label: 'Demo Data',      desc: 'Seed / clear test data' },
  { key: 'Trash',          icon: 'trash',     label: 'Trash',          desc: 'Restore anything deleted (all modules)' },
];

export default function AdminHomeScreen({ navigation }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isAdmin, loading } = useTenantAccess();
  if (!loading && !isAdmin) {
    return <View style={styles.center}><Text style={styles.denied}>Admins only.</Text></View>;
  }
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 14 }}>
      {ROWS.map(r => (
        <TouchableOpacity
          key={r.key}
          style={styles.row}
          activeOpacity={0.7}
          onPress={() => navigation.navigate(r.key, r.key === 'Trash' ? { collections: null } : undefined)}
        >
          <View style={styles.iconWrap}><Icon name={r.icon} size={22} color={theme.green} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{r.label}</Text>
            <Text style={styles.desc}>{r.desc}</Text>
          </View>
          <Text style={styles.chev}>›</Text>
        </TouchableOpacity>
      ))}
      <Text style={styles.note}>
        The full Settings catalog (40+ sections) lives on the web app. The mobile Demo Data seed is a lighter version of the web's full-scale seeder.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:     { flex: 1, backgroundColor: t.bg },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  denied:   { color: t.textFaint, fontSize: 14 },
  row:      { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: t.border },
  iconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: t.greenSoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  label:    { fontSize: 15.5, fontWeight: '700', color: t.text },
  desc:     { fontSize: 12, color: t.textMuted, marginTop: 2 },
  chev:     { fontSize: 24, color: t.textFaint, marginLeft: 6 },
  note:     { fontSize: 12, color: t.textFaint, marginTop: 14, lineHeight: 17, paddingHorizontal: 4 },
});
