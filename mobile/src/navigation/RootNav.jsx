import { useEffect, useState, useMemo } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, TouchableOpacity, Text } from 'react-native';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import ScheduleStack  from './ScheduleStack';
import ClientsStack   from './ClientsStack';
import DashboardScreen from '../screens/DashboardScreen';
import ManageStack    from './ManageStack';
import ProfileScreen  from '../screens/ProfileScreen';
import HelpScreen     from '../screens/HelpScreen';
import usePushRegistration from '../hooks/usePushRegistration';
import { getCurrentTenant, subscribeTenant } from '../lib/currentTenant';
import { useTheme } from '../theme/ThemeContext';
import HeaderTitle from '../components/HeaderTitle';

const Tab = createBottomTabNavigator();

// Inline SVG icons — react-native-svg is already a transitive dep so
// we don't need @expo/vector-icons (which had font-loading issues with
// the dev client on iOS 26 simulator). Strokes are 2 with rounded
// linecaps for a friendly look.
function TabIcon({ name, color }) {
  const props = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'Schedule':
      return <Svg {...props}><Rect x="3" y="4" width="18" height="18" rx="2" /><Path d="M16 2v4M8 2v4M3 10h18" /></Svg>;
    case 'Dashboard':
      return <Svg {...props}><Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><Path d="M9 22V12h6v10" /></Svg>;
    case 'Clients':
      return <Svg {...props}><Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><Circle cx="9" cy="7" r="4" /></Svg>;
    case 'Manage':
      return <Svg {...props}><Rect x="3" y="3" width="7" height="7" rx="1" /><Rect x="14" y="3" width="7" height="7" rx="1" /><Rect x="3" y="14" width="7" height="7" rx="1" /><Rect x="14" y="14" width="7" height="7" rx="1" /></Svg>;
    case 'Profile':
      return <Svg {...props}><Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><Circle cx="12" cy="7" r="4" /></Svg>;
    default:
      return <View style={{ width: 24, height: 24 }} />;
  }
}

// Map nav route name → header title. Mirrors the per-screen `title`
// options below — kept here so HeaderTitle (in screenOptions) can read
// the right label per tab without each screen needing to set
// `headerTitle` individually.
const HEADER_TITLES = {
  Schedule:  'Appointments',
  Dashboard: 'Dashboard',
  Profile:   'Profile',
  Help:      'Help & Support',
};
function titleFor(routeName) { return HEADER_TITLES[routeName] || routeName; }

export default function RootNav() {
  // Register the device for push as soon as the user is signed in. No-op on
  // simulators / unsupported devices; failures are swallowed (push is a
  // value-add, not a blocker for sign-in).
  usePushRegistration();

  // Re-mount the entire navigator when the user switches tenants. Every
  // screen runs its own data-loading effects on mount, so keying the
  // container by tenant ID is the simplest way to make multi-tenant
  // switching force a fresh fetch across all tabs without each screen
  // needing its own subscribeTenant subscription.
  const [tenantId, setTenantId] = useState(getCurrentTenant());
  useEffect(() => subscribeTenant(setTenantId), []);

  const { theme, scheme } = useTheme();
  // Drive React Navigation's own theme so headers, the tab bar, screen
  // backgrounds and transitions all flip with light/dark in one place.
  const navTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: theme.bg, card: theme.navBar, text: theme.text, border: theme.border, primary: theme.blue } };
  }, [scheme, theme]);

  // Memoized so the options factory (and its render-prop closures) keeps a
  // stable identity across re-renders — only rebuilt when the theme changes.
  // `lazy` defers mounting a tab until it's first focused, and `freezeOnBlur`
  // suspends off-screen tabs (react-native-screens) — so we don't run all five
  // tabs' data effects at launch.
  const screenOptions = useMemo(() => ({ route }) => ({
    lazy: true,
    freezeOnBlur: true,
    headerStyle:     { backgroundColor: theme.headerBg },
    headerTintColor: theme.green,
    // Custom 2-line title: screen name on top, current salon name
    // beneath, so multi-tenant users can never lose track of which
    // salon they're scoped to. Sourced from the per-screen options
    // `title` (or the route name as fallback).
    headerTitle: () => <HeaderTitle title={titleFor(route.name)} />,
    tabBarActiveTintColor:   theme.blue,
    tabBarInactiveTintColor: theme.textMuted,
    tabBarLabelStyle:        { fontSize: 11, fontWeight: '600' },
    tabBarStyle:             { backgroundColor: theme.navBar, borderTopColor: theme.border },
    tabBarIcon: ({ color }) => <TabIcon name={route.name} color={color} />,
  }), [theme]);

  return (
    <NavigationContainer key={tenantId} theme={navTheme}>
      <Tab.Navigator
        initialRouteName="Dashboard"
        screenOptions={screenOptions}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen}
          options={({ navigation }) => ({
            title: 'Dashboard',
            headerRight: () => (
              <TouchableOpacity onPress={() => navigation.navigate('Help')}
                style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: theme.green }}>?</Text>
              </TouchableOpacity>
            ),
          })} />
        <Tab.Screen name="Schedule" component={ScheduleStack} options={{ headerShown: false, title: 'Appointments' }} />
        <Tab.Screen
          name="Clients"
          component={ClientsStack}
          options={{ headerShown: false /* the inner stack provides its own header */ }}
        />
        <Tab.Screen
          name="Manage"
          component={ManageStack}
          options={{ headerShown: false /* the inner stack provides its own header */ }}
        />
        <Tab.Screen name="Profile"  component={ProfileScreen} />
        {/* Help is reachable from the Dashboard header "?" — hidden from the tab bar. */}
        <Tab.Screen name="Help" component={HelpScreen} options={{ title: 'Help & Support', tabBarButton: () => null }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
