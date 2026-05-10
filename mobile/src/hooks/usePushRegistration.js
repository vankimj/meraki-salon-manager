import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, arrayUnion, deleteField } from 'firebase/firestore';
import { auth, db, TENANT_ID } from '../lib/firebase';

// Foreground notification behavior — show banner + play sound + badge.
// Without this, foreground notifications are silently dropped.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   true,
  }),
});

async function registerForPushNotificationsAsync() {
  // Push only works on physical devices (sim/emulator just returns).
  if (!Device.isDevice) {
    console.log('[push] skipping — not a physical device');
    return null;
  }

  // Permission gate — request if not yet granted.
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

  // Android needs an explicit notification channel for default behavior.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2D7A5F',
    });
  }

  // Expo's push service handles APNS+FCM behind one token. Server fans
  // out via https://exp.host/--/api/v2/push/send.
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

// Persist the token under the user's role doc so the Cloud Function fan-out
// can look it up. Tokens collected as a set under tenants/{tid}/userPushTokens/{uid}
// keyed by Expo token; multiple devices per user are supported via arrayUnion.
async function savePushTokenForUser(uid, email, token) {
  if (!uid || !token) return;
  const ref = doc(db, 'tenants', TENANT_ID, 'userPushTokens', uid);
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
    // Wait for Firebase auth to settle before grabbing a push token —
    // we need uid to attach the token to a user.
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      try {
        const token = await registerForPushNotificationsAsync();
        if (!token) return;
        if (lastTokenRef.current === token) return; // already saved this session
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

// Defensive helper exposed for sign-out — call before Firebase signOut so the
// user's tokens get cleared and they stop receiving alerts on a shared device.
export async function clearPushTokenForUser(uid) {
  if (!uid) return;
  try {
    const ref = doc(db, 'tenants', TENANT_ID, 'userPushTokens', uid);
    await setDoc(ref, { tokens: deleteField() }, { merge: true });
  } catch (e) {
    console.warn('[push] clear failed:', e?.message);
  }
}
