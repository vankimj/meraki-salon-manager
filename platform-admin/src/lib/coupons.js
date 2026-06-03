// Stripe coupon / promotion-code data layer for the platform-admin console.
// Everything goes through Cloud Functions (the secret Stripe key never
// touches the browser); each callable gates platform-admin auth server-side.

import { fns, httpsCallable } from './firebase.js';

const _listStripeCoupons          = httpsCallable(fns, 'listStripeCoupons');
const _createStripeCoupon         = httpsCallable(fns, 'createStripeCoupon');
const _deleteStripeCoupon         = httpsCallable(fns, 'deleteStripeCoupon');
const _createStripePromotionCode  = httpsCallable(fns, 'createStripePromotionCode');
const _setStripePromotionCodeActive = httpsCallable(fns, 'setStripePromotionCodeActive');

export async function listCoupons() {
  const res = await _listStripeCoupons({});
  return res.data?.coupons || [];
}

export async function createCoupon(input) {
  const res = await _createStripeCoupon(input);
  return res.data?.coupon;
}

export async function deleteCoupon(id) {
  const res = await _deleteStripeCoupon({ id });
  return res.data;
}

export async function createPromotionCode(input) {
  const res = await _createStripePromotionCode(input);
  return res.data?.promotionCode;
}

export async function setPromotionCodeActive(id, active) {
  const res = await _setStripePromotionCodeActive({ id, active });
  return res.data?.promotionCode;
}

// ── Display helpers ──────────────────────────────────────
export function discountLabel(c) {
  if (c.percentOff != null) return `${c.percentOff}% off`;
  if (c.amountOff  != null) return `$${(c.amountOff / 100).toFixed(2)} off`;
  return '—';
}

export function durationLabel(c) {
  if (c.duration === 'forever')   return 'Forever';
  if (c.duration === 'once')      return 'Once';
  if (c.duration === 'repeating') return `${c.durationInMonths} month${c.durationInMonths === 1 ? '' : 's'}`;
  return c.duration || '—';
}

export function fmtUnix(secs) {
  if (!secs) return null;
  return new Date(secs * 1000).toLocaleDateString();
}
