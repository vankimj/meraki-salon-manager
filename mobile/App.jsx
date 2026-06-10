import { useState, useEffect, useRef, useCallback } from 'react';
import { View, ActivityIndicator, AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './src/lib/firebase';
import { loadInitialTenant, clearCurrentTenant } from './src/lib/currentTenant';
import { loadInitialTab } from './src/lib/currentTab';
import { loadInitialPrefs, getPrefs, subscribePrefs } from './src/lib/userPrefs';
import { clearPushTokenForUser } from './src/hooks/usePushRegistration';
import AuthScreen from './src/screens/AuthScreen';
import RootNav    from './src/navigation/RootNav';
import TerminalProvider from './src/components/TerminalProvider';
import ErrorBoundary from './src/components/ErrorBoundary';
import KioskLockGate from './src/components/KioskLockGate';
import KioskRoot from './src/navigation/KioskRoot';
import { loadInitialKioskLock, isKioskLocked, subscribeKioskLock } from './src/lib/kioskLock';
import { ThemeProvider } from './src/theme/ThemeContext';

// Auto-logout — single inactivity timer at the root. Resets on any
// gesture inside the app (touchstart bubbles up through the
// rootResponder View) and on AppState foreground transitions. Sign-out
// path mirrors ProfileScreen.handleSignOut.
function useAutoLogout(user) {
  const timer = useRef(null);

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    if (!user) return;
    if (isKioskLocked()) return;   // unattended kiosk must stay up — don't auto-sign-out
    const minutes = getPrefs().autoLogoutMin;
    if (!minutes) return;            // 0 = off
    timer.current = setTimeout(async () => {
      try { await clearPushTokenForUser(user.uid); } catch {}
      try { await clearCurrentTenant(); } catch {}
      try { await auth.signOut(); } catch {}
    }, minutes * 60_000);
  }, [user]);

  useEffect(() => {
    reset();
    const unsubPrefs = subscribePrefs(reset);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reset();
    });
    return () => { clearTimeout(timer.current); unsubPrefs(); sub.remove(); };
  }, [reset]);

  return reset;   // call from the rootResponder onTouchStart to keep alive
}

export default function App() {
  const [user,    setUser]    = useState(undefined); // undefined = loading
  const [loading, setLoading] = useState(true);
  const [kioskLocked, setKioskLockedState] = useState(false);
  const [kioskClaim,  setKioskClaim]       = useState(false); // dedicated kiosk identity (RBAC #8)?

  useEffect(() => {
    // Load persisted state from AsyncStorage BEFORE any Firestore
    // queries fire (every fetch reads getCurrentTenant() at call time,
    // so it must be hydrated by then).
    let unsub;
    (async () => {
      await loadInitialTenant();
      await loadInitialTab();
      await loadInitialPrefs();
      await loadInitialKioskLock();
      setKioskLockedState(isKioskLocked());
      unsub = onAuthStateChanged(auth, u => {
        setUser(u);
        if (!u) { setKioskClaim(false); setLoading(false); return; }
        // Detect a dedicated kiosk identity (custom-token claim) to pick the
        // kiosk-only root. NEVER block the app on this token call — clear loading
        // on resolve, reject, OR a hard timeout, so a slow/stalled getIdTokenResult
        // can't leave the app spinning forever.
        let done = false;
        const finish = (claim) => { if (done) return; done = true; setKioskClaim(claim); setLoading(false); };
        u.getIdTokenResult().then(r => finish(r.claims?.kiosk === true)).catch(() => finish(false));
        setTimeout(() => finish(false), 4000);
      });
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  // The gate is a RELAUNCH guard (set at boot from the persisted flag). During a
  // live session, entering a kiosk must NOT swap the running app to the gate —
  // the kiosk's own navigation handles that. So react only to CLEARING (unlock /
  // exit), which flips back to the normal app.
  useEffect(() => subscribeKioskLock(r => { if (!r) setKioskLockedState(false); }), []);

  const resetIdle = useAutoLogout(user);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f1923' }}>
        <ActivityIndicator color="#3D9E8A" size="large" />
      </View>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <View style={{ flex: 1 }} onTouchStart={resetIdle}>
          <ErrorBoundary>
            {user
              ? (kioskClaim
                  ? <TerminalProvider><KioskRoot /></TerminalProvider>   // dedicated kiosk: claim-driven, never the PIN gate
                  : kioskLocked ? <KioskLockGate />
                  : <TerminalProvider><RootNav /></TerminalProvider>)
              : <AuthScreen />}
          </ErrorBoundary>
        </View>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
