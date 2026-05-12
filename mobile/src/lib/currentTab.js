// Per-user "tab" — appointments the tech / front desk has staged for
// checkout. Mirrors the web `ticket` concept in src/context/AppContext
// but lives in AsyncStorage so it survives app restarts. Keyed by
// tenant + signed-in user email so multiple staff on the same device
// don't clobber each other's in-progress checkouts.
//
// Future: products + NFC tap-to-pay. The shape stays { appts: [], products: [] }
// even though products is empty for now, so the cart screen can render
// both sections without a schema migration when products land.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from './firebase';
import { getCurrentTenant } from './currentTenant';

function storageKey() {
  const email = (auth.currentUser?.email || 'anon').toLowerCase();
  return `currentTab:${getCurrentTenant()}:${email}`;
}

const EMPTY = { appts: [], products: [] };
let tab = EMPTY;
let loaded = false;
const subscribers = new Set();

function notify() {
  subscribers.forEach(cb => { try { cb(tab); } catch (_) {} });
}

export async function loadInitialTab() {
  if (loaded) return tab;
  try {
    const raw = await AsyncStorage.getItem(storageKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      tab = {
        appts:    Array.isArray(parsed.appts)    ? parsed.appts    : [],
        products: Array.isArray(parsed.products) ? parsed.products : [],
      };
    }
  } catch (_) { /* AsyncStorage failed — stay empty */ }
  loaded = true;
  notify();
  return tab;
}

async function persist() {
  try { await AsyncStorage.setItem(storageKey(), JSON.stringify(tab)); } catch (_) {}
}

export function getCurrentTab() { return tab; }
export function tabCount() { return tab.appts.length + tab.products.reduce((s, p) => s + (p.qty || 1), 0); }
export function tabTotal() {
  // Sum of all appt service prices — sane default until products land.
  // Matches the web's ticket subtotal calc minus the product piece.
  return tab.appts.reduce((s, a) => {
    const svcSum = (a.services || []).reduce((ss, sv) => ss + (Number(sv.price) || 0), 0);
    return s + svcSum;
  }, 0);
}

export async function addApptToTab(appt) {
  if (!appt?.id) return;
  if (tab.appts.some(a => a.id === appt.id)) return;
  tab = { ...tab, appts: [...tab.appts, appt] };
  await persist();
  notify();
}

export async function removeApptFromTab(apptId) {
  if (!apptId) return;
  tab = { ...tab, appts: tab.appts.filter(a => a.id !== apptId) };
  await persist();
  notify();
}

export async function clearTab() {
  tab = { ...EMPTY };
  await persist();
  notify();
}

export function subscribeTab(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
