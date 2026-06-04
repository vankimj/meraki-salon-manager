import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import ManageCrud from './ManageCrud';
import useTenantAccess from '../../hooks/useTenantAccess';
import useTrashHeader from '../../hooks/useTrashHeader';
import {
  fetchGiftCards, createGiftCard, updateGiftCard, deleteGiftCard,
  fetchPromoCodes, createPromoCode, savePromoCode, deletePromoCode,
} from '../../lib/firestore';
import { useThemedStyles } from '../../theme/ThemeContext';

function genCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor((i * 7 + s.length * 13 + 5) % chars.length)];
  return `${prefix}-${s}`;
}

const CARD_FIELDS = [
  { key: 'code',    label: 'Code',        type: 'text',   required: true },
  { key: 'value',   label: 'Value ($)',   type: 'number', placeholder: '50' },
  { key: 'balance', label: 'Balance ($)', type: 'number', placeholder: '50' },
  { key: 'active',  label: 'Active',      type: 'bool' },
  { key: 'voided',  label: 'Void this card', type: 'bool' },
];

const PROMO_FIELDS = [
  { key: 'code',           label: 'Code',         type: 'text',   required: true },
  { key: 'type',           label: 'Type',         type: 'select', options: [{ value: 'percent', label: '% off' }, { value: 'amount', label: '$ off' }] },
  { key: 'discountPct',    label: 'Percent off',  type: 'number', placeholder: '10' },
  { key: 'discountAmount', label: 'Amount off ($)', type: 'number', placeholder: '5' },
  { key: 'maxUses',        label: 'Max uses (0 = ∞)', type: 'number', placeholder: '0' },
  { key: 'active',         label: 'Active',       type: 'bool' },
];

export default function GiftCardsScreen({ navigation }) {
  const { isAdmin } = useTenantAccess();
  useTrashHeader(navigation, ['giftCards', 'promoCodes'], isAdmin);
  const [tab, setTab] = useState('cards');
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        {[{ id: 'cards', label: 'Gift Cards' }, { id: 'promos', label: 'Promo Codes' }].map(t => (
          <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} style={[styles.tab, tab === t.id && styles.tabOn]}>
            <Text style={[styles.tabText, tab === t.id && styles.tabTextOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'cards' ? (
        <ManageCrud
          load={fetchGiftCards}
          create={(d) => createGiftCard({ ...d, balance: d.balance || d.value })}
          save={(id, d) => updateGiftCard(id, d.voided ? { ...d, balance: 0, active: false, voidedAt: new Date().toISOString() } : d)}
          remove={deleteGiftCard}
          canEdit={isAdmin}
          blank={() => ({ code: genCode('GC'), value: 0, balance: 0, active: true, voided: false })}
          fields={CARD_FIELDS}
          titleOf={(c) => c.code}
          subtitleOf={(c) => c.voided ? `VOIDED · was $${c.value ?? 0}` : `$${c.balance ?? c.value ?? 0} of $${c.value ?? 0}${c.active === false ? ' · inactive' : ''}`}
          addLabel="New gift card"
        />
      ) : (
        <ManageCrud
          load={fetchPromoCodes}
          create={createPromoCode}
          save={savePromoCode}
          remove={deletePromoCode}
          canEdit={isAdmin}
          blank={() => ({ code: genCode('PROMO'), type: 'percent', discountPct: 0, discountAmount: 0, maxUses: 0, active: true })}
          fields={PROMO_FIELDS}
          titleOf={(p) => p.code}
          subtitleOf={(p) => {
            const amt = p.type === 'amount' ? `$${p.discountAmount || 0} off` : `${p.discountPct || 0}% off`;
            const uses = p.maxUses ? ` · ${p.usedCount || 0}/${p.maxUses}` : '';
            return `${amt}${uses}${p.active === false ? ' · inactive' : ''}`;
          }}
          addLabel="New promo"
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
