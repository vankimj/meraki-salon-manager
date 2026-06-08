import AsyncStorage from '@react-native-async-storage/async-storage';

// Optional Face ID / Touch ID app lock (req 1.7 — recommended). expo-local-
// authentication is a native module present only in a rebuilt binary; lazy-
// required so the pre-rebuild bundle never crashes (every call degrades to a
// safe default when the module is absent).
let LA = null;
try { LA = require('expo-local-authentication'); } catch { LA = null; }

const KEY = 'pn_biolock_enabled';

export async function isBiometricAvailable() {
  if (!LA) return false;
  try { return (await LA.hasHardwareAsync()) && (await LA.isEnrolledAsync()); }
  catch { return false; }
}

export async function getBioLockEnabled() {
  try { return (await AsyncStorage.getItem(KEY)) === '1'; } catch { return false; }
}

export async function setBioLockEnabled(on) {
  try { await AsyncStorage.setItem(KEY, on ? '1' : '0'); } catch { /* best-effort */ }
}

export async function authenticateBiometric() {
  if (!LA) return true;   // no module → don't lock the user out
  try {
    const r = await LA.authenticateAsync({ promptMessage: 'Unlock Plume Nexus', fallbackLabel: 'Use passcode', disableDeviceFallback: false });
    return !!r.success;
  } catch { return false; }
}
