import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import Icon from '../../components/Icon';
import useTenantAccess from '../../hooks/useTenantAccess';
import useResponsive from '../../hooks/useResponsive';
import { getVisibleModules, moduleMeta } from '../../lib/modules';
import { fetchSettings } from '../../lib/firestore';
import { subscribeTenant } from '../../lib/currentTenant';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Mirrors the web /manage tile grid. Visibility is computed by the
// shared getVisibleModules() (plan gate + adminOnly + owner-disabled +
// hidden-tiles), so anything the signed-in user can't access is never
// rendered. Built modules navigate to their screen / tab; not-yet-built
// ones open a "Coming soon" placeholder.
export default function ManageGridScreen({ navigation }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isAdmin, plan, loading: accessLoading } = useTenantAccess();
  const { columns } = useResponsive();
  // 2 cols (phone) → 48.5%, 3 → 31.8%, 4 → 23.4%. space-between handles gaps.
  const tileW = columns === 2 ? '48.5%' : columns === 3 ? '31.8%' : '23.4%';
  const [settings, setSettings] = useState(null);
  const [loaded,   setLoaded]   = useState(false);

  const load = useCallback(async () => {
    try { setSettings(await fetchSettings()); }
    catch { setSettings(null); }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeTenant(() => { setLoaded(false); load(); }), [load]);

  // If data/settings isn't readable by this (non-admin) staff member,
  // fall back to the coarse plan from useTenantAccess so plan gating
  // still applies (owner-disabled / hidden-tiles just won't).
  const effSettings = settings || (plan ? { plan } : { plan: 'starter' });
  const visible = getVisibleModules(effSettings, { isAdmin });

  function openModule(mod) {
    const meta = moduleMeta(mod.id);
    if (meta.tab)    { navigation.getParent()?.navigate(meta.tab); return; }
    if (meta.screen) { navigation.navigate(meta.screen); return; }
    navigation.navigate('ModulePlaceholder', { id: mod.id, label: mod.label, desc: mod.desc });
  }

  if (accessLoading && !loaded) {
    return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}
    >
      <View style={styles.gridWrap}>
        {visible.map(mod => {
          const meta  = moduleMeta(mod.id);
          const built = !!(meta.tab || meta.screen);
          return (
            <TouchableOpacity
              key={mod.id}
              style={[styles.tile, { width: tileW }]}
              activeOpacity={0.7}
              onPress={() => openModule(mod)}
            >
              <View style={styles.iconWrap}>
                <Icon name={meta.icon} size={26} color={theme.green} />
              </View>
              <Text style={styles.tileLabel} numberOfLines={1}>{mod.label}</Text>
              <Text style={styles.tileDesc} numberOfLines={2}>{mod.desc}</Text>
              {!built && <View style={styles.soonPill}><Text style={styles.soonText}>Coming soon</Text></View>}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[styles.tile, styles.kioskTile, { width: tileW }]}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('Kiosk')}
        >
          <View style={[styles.iconWrap, styles.kioskIconWrap]}>
            <Icon name="dollar" size={26} color={theme.blue} />
          </View>
          <Text style={styles.tileLabel} numberOfLines={1}>Front Desk Kiosk</Text>
          <Text style={styles.tileDesc} numberOfLines={2}>Customer checkout display</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tile, { width: tileW }]}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('Receipts')}
        >
          <View style={styles.iconWrap}>
            <Icon name="mail" size={26} color={theme.green} />
          </View>
          <Text style={styles.tileLabel} numberOfLines={1}>Sales & Receipts</Text>
          <Text style={styles.tileDesc} numberOfLines={2}>Resend a receipt by text or email</Text>
        </TouchableOpacity>

        {isAdmin && (
          <TouchableOpacity
            style={[styles.tile, styles.adminTile, { width: tileW }]}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('AdminHome')}
          >
            <View style={[styles.iconWrap, styles.adminIconWrap]}>
              <Icon name="briefcase" size={26} color={theme.danger} />
            </View>
            <Text style={styles.tileLabel} numberOfLines={1}>Admin</Text>
            <Text style={styles.tileDesc} numberOfLines={2}>Users, settings, logs & trash</Text>
          </TouchableOpacity>
        )}
      </View>
      {visible.length === 0 && (
        <Text style={styles.empty}>No modules available for your role.</Text>
      )}
    </ScrollView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: t.bg },
  content:  { padding: 14, paddingBottom: 40 },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: {
    width: '48.5%', backgroundColor: t.surface, borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: t.border,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  iconWrap: {
    width: 46, height: 46, borderRadius: 12, backgroundColor: t.greenSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  tileLabel: { fontSize: 15, fontWeight: '700', color: t.text },
  tileDesc:  { fontSize: 11.5, color: t.textMuted, marginTop: 3, lineHeight: 15 },
  soonPill:  { alignSelf: 'flex-start', marginTop: 8, backgroundColor: t.warningBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  soonText:  { fontSize: 10, fontWeight: '700', color: t.warning, letterSpacing: 0.2 },
  adminTile:    { borderColor: t.dangerBg },
  kioskTile:    { borderColor: t.blueSoft },
  kioskIconWrap:{ backgroundColor: t.blueSoft },
  adminIconWrap:{ backgroundColor: t.dangerBg },
  empty:     { textAlign: 'center', color: t.textFaint, marginTop: 40, fontSize: 13 },
});
