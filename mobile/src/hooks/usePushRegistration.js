import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, arrayUnion, deleteField } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { getCurrentTenant } from '../lib/currentTenant';

// In Expo Go (SDK 53+) parts of expo-notifications are stubbed/removed.
// We dynamic-import inside the effect AND wrap each call in try/catch so
// a missing native module never throws at module-load time and crashes
// the app's root with "main has not been registered."
const isExpoGo = Constants.appOwnership === 'expo';

async function setForegroundHandler() {
  if (isExpoGo) return;
  try {
    const Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList:   true,
        shouldPlaySound:  true,
        shouldSetBadge:   true,
      }),
    });
  } catch (e) {
    console.log('[push] foreground handler unavailable:', e?.message);
  }
}

async function registerForPushNotificationsAsync() {
  // Skip everything in Expo Go — push isn't supported there since SDK 53.
  // Skip on simulators/emulators (Device.isDevice false).
  if (isExpoGo) {
    console.log('[push] skipping — running in Expo Go');
    return null;
  }

  let Notifications, Device;
  try {
    Notifications = await import('expo-notifications');
    Device        = await import('expo-device');
  } catch (e) {
    console.log('[push] modules unavailable:', e?.message);
    return null;
  }

  if (!Device.isDevice) {
    console.log('[push] skipping — not a physical device');
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.log('[push] permission denied');
    return null;
  }

  if (Platform.OS === 'android') {
    try {
      // HIGH importance → heads-up banner + sound (DEFAULT lands silently in the
      // tray). Android locks a channel's importance after creation, so a fresh
      // install picks this up; existing installs keep their prior level.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Notifications',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#2D7A5F',
      });
    } catch {}
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId
    || Constants.easConfig?.projectId;
  try {
    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return tokenResp.data;
  } catch (e) {
    console.warn('[push] getExpoPushTokenAsync failed:', e?.message);
    return null;
  }
}

async function savePushTokenForUser(uid, email, token) {
  if (!uid || !token) return;
  const ref = doc(db, 'tenants', getCurrentTenant(), 'userPushTokens', uid);
  await setDoc(ref, {
    email: (email || '').toLowerCase(),
    tokens: arrayUnion(token),
    platform: Platform.OS,
    lastSeenAt: new Date().toISOString(),
  }, { merge: true });
}

export default function usePushRegistration() {
  const lastTokenRef = useRef(null);

  useEffect(() => {
    setForegroundHandler();
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      try {
        const token = await registerForPushNotificationsAsync();
        if (!token) return;
        if (lastTokenRef.current === token) return;
        await savePushTokenForUser(user.uid, user.email, token);
        lastTokenRef.current = token;
        console.log('[push] registered token for', user.email);
      } catch (e) {
        console.warn('[push] registration failed:', e?.message);
      }
    });
    return unsub;
  }, []);
}

export async function clearPushTokenForUser(uid) {
  if (!uid) return;
  try {
    const ref = doc(db, 'tenants', getCurrentTenant(), 'userPushTokens', uid);
    await setDoc(ref, { tokens: deleteField() }, { merge: true });
  } catch (e) {
    console.warn('[push] clear failed:', e?.message);
  }
}
