// Mobile build label — mirrors the web app's src/lib/version.js BUILD_LABEL.
// The web stamps the git SHA at build time; on mobile the natural equivalent is
// the expo-updates `updateId`, which changes on EVERY `eas update` publish, so
// the label is a reliable "which JS bundle is actually live on this device"
// signal. On a fresh embedded build (no OTA applied yet) updateId is null.
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

export const APP_VERSION = Constants.expoConfig?.version || '1.0.0';

let shortId = 'embedded';
let builtOn = '';
try {
  if (Updates.updateId) shortId = String(Updates.updateId).slice(0, 7);
  if (Updates.createdAt) builtOn = new Date(Updates.createdAt).toISOString().slice(0, 10);
} catch { /* dev / updates disabled — keep defaults */ }

export const BUILD_ID = shortId;
export const BUILD_LABEL = `v${APP_VERSION} · ${shortId}${builtOn ? ` · ${builtOn}` : ''}`;
