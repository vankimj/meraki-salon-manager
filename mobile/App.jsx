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

  useEffect(() => {
    // Load persisted state from AsyncStorage BEFORE any Firestore
    // queries fire (every fetch reads getCurrentTenant() at call time,
    // so it must be hydrated by then).
    let unsub;
    (async () => {
      await loadInitialTenant();
      await loadInitialTab();
      await loadInitialPrefs();
      unsub = onAuthStateChanged(auth, u => {
        setUser(u);
        setLoading(false);
      });
    })();
    return () => { if (unsub) unsub(); };
  }, []);

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
          {user ? <TerminalProvider><RootNav /></TerminalProvider> : <AuthScreen />}
        </View>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
