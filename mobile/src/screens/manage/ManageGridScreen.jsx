import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import Icon from '../../components/Icon';
import useTenantAccess from '../../hooks/useTenantAccess';
import { getVisibleModules, moduleMeta } from '../../lib/modules';
import { fetchSettings } from '../../lib/firestore';
import { subscribeTenant } from '../../lib/currentTenant';

const BRAND_GREEN = '#2D7A5F';
const BRAND_BLUE  = '#3D95CE';

// Mirrors the web /manage tile grid. Visibility is computed by the
// shared getVisibleModules() (plan gate + adminOnly + owner-disabled +
// hidden-tiles), so anything the signed-in user can't access is never
// rendered. Built modules navigate to their screen / tab; not-yet-built
// ones open a "Coming soon" placeholder.
export default function ManageGridScreen({ navigation }) {
  const { isAdmin, plan, loading: accessLoading } = useTenantAccess();
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
    return <View style={styles.center}><ActivityIndicator color={BRAND_GREEN} /></View>;
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={BRAND_GREEN} />}
    >
      <View style={styles.gridWrap}>
        {visible.map(mod => {
          const meta  = moduleMeta(mod.id);
          const built = !!(meta.tab || meta.screen);
          return (
            <TouchableOpacity
              key={mod.id}
              style={styles.tile}
              activeOpacity={0.7}
              onPress={() => openModule(mod)}
            >
              <View style={styles.iconWrap}>
                <Icon name={meta.icon} size={26} color={BRAND_GREEN} />
              </View>
              <Text style={styles.tileLabel} numberOfLines={1}>{mod.label}</Text>
              <Text style={styles.tileDesc} numberOfLines={2}>{mod.desc}</Text>
              {!built && <View style={styles.soonPill}><Text style={styles.soonText}>Coming soon</Text></View>}
            </TouchableOpacity>
          );
        })}
      </View>
      {visible.length === 0 && (
        <Text style={styles.empty}>No modules available for your role.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: '#f5f7fa' },
  content:  { padding: 14, paddingBottom: 40 },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: {
    width: '48.5%', backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#ececec',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  iconWrap: {
    width: 46, height: 46, borderRadius: 12, backgroundColor: '#eef5f2',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  tileLabel: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  tileDesc:  { fontSize: 11.5, color: '#8a8a8a', marginTop: 3, lineHeight: 15 },
  soonPill:  { alignSelf: 'flex-start', marginTop: 8, backgroundColor: '#fdf2e6', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  soonText:  { fontSize: 10, fontWeight: '700', color: '#c47d2e', letterSpacing: 0.2 },
  empty:     { textAlign: 'center', color: '#999', marginTop: 40, fontSize: 13 },
});
