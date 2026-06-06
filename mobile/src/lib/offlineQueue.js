// Offline sale queue for the POS. When the connectivity probe says we're
// offline, a sale's completeSale() arguments are stashed here (AsyncStorage,
// so they survive an app restart) instead of being written, then replayed when
// connectivity returns. The sale's stable saleId makes replay idempotent on
// the critical writes (receipt id + setDoc-merge appts), and because we
// DETECT-then-write (never both), the non-idempotent side effects (gift-card
// debit, store-credit, stock) run exactly once — at flush time. Keyed per
// tenant like currentTab so multiple salons on one device don't mix queues.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentTenant } from './currentTenant';

const key = () => `offlineSales:${getCurrentTenant()}`;

export async function listQueuedSales() {
  try {
    const raw = await AsyncStorage.getItem(key());
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a : [];
  } catch (_) {
    return [];
  }
}

async function writeQueue(list) {
  try { await AsyncStorage.setItem(key(), JSON.stringify(list)); } catch (_) { /* best effort */ }
}

// Stash a sale's completeSale args. Dedup by saleId so a double-tap (or a retry
// while still offline) never queues the same sale twice. Returns queue length.
export async function enqueueSale(args) {
  const list = await listQueuedSales();
  if (args?.saleId && list.some(x => x.saleId === args.saleId)) return list.length;
  list.push({ saleId: args?.saleId || null, queuedAt: new Date().toISOString(), args });
  await writeQueue(list);
  return list.length;
}

export async function removeQueuedSale(saleId) {
  const list = await listQueuedSales();
  await writeQueue(list.filter(x => x.saleId !== saleId));
}

export async function queuedSaleCount() {
  return (await listQueuedSales()).length;
}

// Replay queued sales oldest-first while online. completeSaleFn + isOnlineFn are
// injected so this module stays pure/testable. Each success removes its entry;
// a failure stops the run (likely went offline again) to preserve order and not
// hammer a dead network. Returns { flushed, remaining }.
export async function flushQueue(completeSaleFn, isOnlineFn) {
  const list = await listQueuedSales();
  let flushed = 0;
  for (const item of list) {
    if (isOnlineFn && !(await isOnlineFn())) break;
    try {
      await completeSaleFn(item.args);
      await removeQueuedSale(item.saleId);
      flushed++;
    } catch (_) {
      break;
    }
  }
  return { flushed, remaining: (await listQueuedSales()).length };
}
