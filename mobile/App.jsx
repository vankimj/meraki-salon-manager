import { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './src/lib/firebase';
import { loadInitialTenant } from './src/lib/currentTenant';
import { loadInitialTab } from './src/lib/currentTab';
import AuthScreen from './src/screens/AuthScreen';
import RootNav    from './src/navigation/RootNav';

export default function App() {
  const [user,    setUser]    = useState(undefined); // undefined = loading
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load the persisted tenant selection from AsyncStorage BEFORE any
    // Firestore queries fire (every fetch reads getCurrentTenant() at
    // call time, so it must be hydrated by then).
    let unsub;
    (async () => {
      await loadInitialTenant();
      await loadInitialTab();
      unsub = onAuthStateChanged(auth, u => {
        setUser(u);
        setLoading(false);
      });
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f1923' }}>
        <ActivityIndicator color="#3D9E8A" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {user ? <RootNav /> : <AuthScreen />}
    </SafeAreaProvider>
  );
}
