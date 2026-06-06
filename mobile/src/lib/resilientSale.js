// One entry point both the tech checkout and the kiosk use to record a sale so
// they behave identically online and offline. Probe first: if reachable, write
// straight through completeSale (normal path, with its own retry UI on
// failure); if not, queue the args and report it so the UI can say "saved
// offline — will sync." Card sales are gated upstream (Stripe needs a live
// link), so only cash / store-credit sales ever reach the queue.
import { completeSale } from './completeSale';
import { checkOnline } from './connectivity';
import { enqueueSale, flushQueue } from './offlineQueue';

export async function recordSale(args) {
  const online = await checkOnline();
  if (!online) {
    await enqueueSale(args);
    return { queued: true, result: null };
  }
  const result = await completeSale(args);
  return { queued: false, result };
}

// Sync anything stranded offline. Safe to call on screen mount / app resume.
export async function syncOfflineSales() {
  return flushQueue(completeSale, checkOnline);
}
