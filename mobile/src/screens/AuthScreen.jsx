import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { GoogleAuthProvider, OAuthProvider, signInWithCredential, signInAnonymously } from 'firebase/auth';
import Constants from 'expo-constants';
import { auth, ALLOWED_EMAILS } from '../lib/firebase';
import { useThemedStyles } from '../theme/ThemeContext';

// Apple requires a one-time nonce: send SHA256(rawNonce) to Apple, pass rawNonce
// to Firebase so it can verify the returned id_token wasn't replayed.
function randomNonce(len = 32) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._';
  const bytes = Crypto.getRandomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// EAS Dev Client / production native build: real Google Sign-In via the
// native SDK. We pass BOTH the iOS-specific client ID (matches bundle id
// app.plumenexus.pro) AND the Web client ID. The Web client ID is what
// Firebase Auth expects for `GoogleAuthProvider.credential(idToken)` —
// it's the audience the returned id_token is signed for. Both clients
// live in the plumenexus-prod project (number 563347750501); the old
// 721171829996 clients were from the pre-migration project and rejected
// id_tokens as invalid_audience.
const WEB_CLIENT_ID = '563347750501-jlmqatcbesk7r9ltou2sl928sgmtk606.apps.googleusercontent.com';
const IOS_CLIENT_ID = '563347750501-n1pe3i700s6fh75cpu1sspjjd63n04oa.apps.googleusercontent.com';

// In Expo Go the native module isn't available — guard the configure
// call so the screen still renders (with the dev-anonymous fallback).
const isExpoGo = Constants.appOwnership === 'expo';
if (!isExpoGo) {
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
    iosClientId: IOS_CLIENT_ID,
    offlineAccess: false,
  });
}

export default function AuthScreen() {
  const [loading, setLoading] = useState(false);
  // Only show the Apple button when the native module is actually present (true
  // on iOS 13+ builds that include expo-apple-authentication). Keeps this safe to
  // ship to a build that predates the native rebuild — the button just hides.
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);
  const styles = useThemedStyles(makeStyles);

  async function handleGoogleSignIn() {
    if (isExpoGo) {
      Alert.alert(
        'Expo Go limitation',
        'Real Google Sign-In requires an EAS Dev Client build. For now use the dev button below.',
      );
      return;
    }
    setLoading(true);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      // v13+ returns { type, data: { idToken, user } }; older returns flat.
      const idToken = result?.data?.idToken || result?.idToken;
      if (!idToken) throw new Error('No idToken returned by Google.');

      const credential = GoogleAuthProvider.credential(idToken);
      const fbResult = await signInWithCredential(auth, credential);
      const email = (fbResult.user.email || '').toLowerCase();

      if (!ALLOWED_EMAILS.includes(email)) {
        // Bootstrap admins get through immediately; others rely on
        // Firestore rules to gate data. The web app calls
        // getMyTenantRole here for a friendlier denied screen — we'll
        // mirror that in Phase 4.
        console.log('[auth] non-bootstrap signed in:', email);
      }
    } catch (err) {
      if (err?.code === statusCodes?.SIGN_IN_CANCELLED) return;
      Alert.alert('Sign-in failed', err?.message || 'Could not sign in.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAppleSignIn() {
    setLoading(true);
    try {
      const rawNonce = randomNonce();
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      if (!cred.identityToken) throw new Error('No identity token returned by Apple.');
      const provider = new OAuthProvider('apple.com');
      const firebaseCred = provider.credential({ idToken: cred.identityToken, rawNonce });
      await signInWithCredential(auth, firebaseCred);
    } catch (err) {
      if (err?.code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert('Apple sign-in failed', err?.message || 'Could not sign in.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.brand}>Plume Nexus</Text>
        <Text style={styles.sub}>SALON MANAGER</Text>

        <TouchableOpacity
          style={[styles.googleBtn, loading && { opacity: 0.6 }]}
          onPress={handleGoogleSignIn}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.googleBtnText}>Sign in with Google</Text>
          }
        </TouchableOpacity>

        {appleAvailable && !isExpoGo && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
            cornerRadius={12}
            style={styles.appleBtn}
            onPress={handleAppleSignIn}
          />
        )}

        {/* Dev-only escape hatch for testing UI inside Expo Go where
            the native Google SDK isn't available. Remove before App Store. */}
        {isExpoGo && (
          <TouchableOpacity
            style={styles.devBtn}
            onPress={async () => {
              setLoading(true);
              try {
                await signInAnonymously(auth);
              } catch (e) {
                Alert.alert(
                  'Anonymous sign-in disabled',
                  'Enable Anonymous in Firebase Console → Authentication → Sign-in method.',
                );
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
          >
            <Text style={styles.devBtnText}>Dev: continue without sign-in</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card:      { width: '100%', maxWidth: 320, alignItems: 'center', gap: 8 },
  brand:     { fontSize: 52, fontWeight: '400', color: t.text, letterSpacing: 2 },
  sub:       { fontSize: 14, fontWeight: '700', color: t.teal, letterSpacing: 6 },
  tagline:   { fontSize: 12, color: t.textMuted, letterSpacing: 3, marginBottom: 40, textTransform: 'uppercase' },
  googleBtn: { width: '100%', backgroundColor: t.blue, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  googleBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  appleBtn:  { width: '100%', height: 48, marginTop: 12 },
  devBtn:    { width: '100%', paddingVertical: 12, alignItems: 'center', marginTop: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, borderStyle: 'dashed' },
  devBtnText:{ color: t.textMuted, fontSize: 12, fontWeight: '500', letterSpacing: 0.4 },
});
