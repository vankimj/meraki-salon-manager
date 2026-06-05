import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import ManageCrud from './ManageCrud';
import useTenantAccess from '../../hooks/useTenantAccess';
import useTrashHeader from '../../hooks/useTrashHeader';
import { useThemedStyles } from '../../theme/ThemeContext';
import {
  fetchMembershipPlans, createMembershipPlan, saveMembershipPlan, deleteMembershipPlan,
  fetchMemberships, createMembership, saveMembership, deleteMembership,
} from '../../lib/firestore';

const PERIODS = [{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }];

const PLAN_FIELDS = [
  { key: 'name',          label: 'Plan name',   type: 'text',   required: true, placeholder: 'VIP Monthly' },
  { key: 'price',         label: 'Price ($)',   type: 'number', placeholder: '49' },
  { key: 'billingPeriod', label: 'Billing',     type: 'select', options: PERIODS },
  { key: 'description',   label: 'Description', type: 'text',   placeholder: 'Optional' },
  { key: 'active',        label: 'Active',      type: 'bool' },
];

const MEMBER_FIELDS = [
  { key: 'clientName',    label: 'Member name', type: 'text',   required: true },
  { key: 'planName',      label: 'Plan',        type: 'text',   placeholder: 'VIP Monthly' },
  { key: 'price',         label: 'Price ($)',   type: 'number', placeholder: '49' },
  { key: 'billingPeriod', label: 'Billing',     type: 'select', options: PERIODS },
  { key: 'status',        label: 'Status',      type: 'select', options: [
    { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'cancelled', label: 'Cancelled' },
  ] },
];

function mrr(members) {
  return members
    .filter(m => m.status === 'active')
    .reduce((s, m) => s + (Number(m.price) || 0) * (m.billingPeriod === 'yearly' ? 1 / 12 : 1), 0);
}

export default function MembershipsScreen({ navigation }) {
  const { isAdmin } = useTenantAccess();
  useTrashHeader(navigation, ['memberships', 'membershipPlans'], isAdmin);
  const [tab, setTab] = useState('plans');
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        {[{ id: 'plans', label: 'Plans' }, { id: 'members', label: 'Members' }].map(t => (
          <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} style={[styles.tab, tab === t.id && styles.tabOn]}>
            <Text style={[styles.tabText, tab === t.id && styles.tabTextOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'plans' ? (
        <ManageCrud
          load={fetchMembershipPlans}
          create={createMembershipPlan}
          save={saveMembershipPlan}
          remove={deleteMembershipPlan}
          canEdit={isAdmin}
          blank={() => ({ name: '', price: 0, billingPeriod: 'monthly', description: '', active: true })}
          fields={PLAN_FIELDS}
          titleOf={(p) => p.name}
          subtitleOf={(p) => `$${p.price || 0}/${p.billingPeriod === 'yearly' ? 'yr' : 'mo'}${p.active === false ? ' · inactive' : ''}`}
          addLabel="New plan"
        />
      ) : (
        <ManageCrud
          load={fetchMemberships}
          create={(d) => createMembership({ ...d, startedAt: new Date().toISOString() })}
          save={saveMembership}
          remove={deleteMembership}
          canEdit={isAdmin}
          blank={() => ({ clientName: '', planName: '', price: 0, billingPeriod: 'monthly', status: 'active' })}
          fields={MEMBER_FIELDS}
          titleOf={(m) => m.clientName}
          subtitleOf={(m) => `${m.planName || '—'} · $${m.price || 0}/${m.billingPeriod === 'yearly' ? 'yr' : 'mo'} · ${m.status}`}
          addLabel="Add member"
          headerNote={(members) => {
            const m = mrr(members);
            return `MRR $${m.toFixed(0)} · ARR $${(m * 12).toFixed(0)} · ${members.filter(x => x.status === 'active').length} active`;
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: t.bg },
  tabs:      { flexDirection: 'row', backgroundColor: t.surface, padding: 6, gap: 6, borderBottomWidth: 1, borderBottomColor: t.border },
  tab:       { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: t.surfaceAlt },
  tabOn:     { backgroundColor: t.greenSoft },
  tabText:   { fontSize: 13, fontWeight: '700', color: t.textMuted },
  tabTextOn: { color: t.green },
});
