import { createNativeStackNavigator } from '@react-navigation/native-stack';
import KioskScreen from '../screens/kiosk/KioskScreen';

// RBAC #8 — the ONLY thing a dedicated kiosk identity renders. A kiosk session
// (custom-token claim kiosk:true) has no staff role, so it never sees the tabbed
// app; App.jsx routes it straight here. No tabs, no gestures, no back — and the
// session itself can't reach anything else even if this is somehow escaped.
const Stack = createNativeStackNavigator();

export default function KioskRoot() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, gestureEnabled: false }}>
      <Stack.Screen name="Kiosk" component={KioskScreen} />
    </Stack.Navigator>
  );
}
