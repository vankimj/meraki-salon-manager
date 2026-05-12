import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View } from 'react-native';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import ScheduleScreen from '../screens/ScheduleScreen';
import ClientsStack   from './ClientsStack';
import EarningsScreen from '../screens/EarningsScreen';
import ChatStack      from './ChatStack';
import ProfileScreen  from '../screens/ProfileScreen';
import usePushRegistration from '../hooks/usePushRegistration';
import { getCurrentTenant, subscribeTenant } from '../lib/currentTenant';
import HeaderTitle from '../components/HeaderTitle';

const Tab = createBottomTabNavigator();

const BRAND_GREEN  = '#2D7A5F';
const BRAND_BLUE   = '#3D95CE';
const TAB_INACTIVE = '#9aa3ad';

// Inline SVG icons — react-native-svg is already a transitive dep so
// we don't need @expo/vector-icons (which had font-loading issues with
// the dev client on iOS 26 simulator). Strokes are 2 with rounded
// linecaps for a friendly look.
function TabIcon({ name, color }) {
  const props = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'Schedule':
      return <Svg {...props}><Rect x="3" y="4" width="18" height="18" rx="2" /><Path d="M16 2v4M8 2v4M3 10h18" /></Svg>;
    case 'Earnings':
      return <Svg {...props}><Path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></Svg>;
    case 'Clients':
      return <Svg {...props}><Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><Circle cx="9" cy="7" r="4" /></Svg>;
    case 'Chat':
      return <Svg {...props}><Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></Svg>;
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
  Schedule: 'Today',
  Earnings: 'Earnings',
  Profile:  'Profile',
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

  return (
    <NavigationContainer key={tenantId}>
      <Tab.Navigator
        initialRouteName="Schedule"
        screenOptions={({ route }) => ({
          headerStyle:     { backgroundColor: '#fff' },
          headerTintColor: BRAND_GREEN,
          // Custom 2-line title: screen name on top, current salon name
          // beneath, so multi-tenant users can never lose track of which
          // salon they're scoped to. Sourced from the per-screen options
          // `title` (or the route name as fallback).
          headerTitle: () => <HeaderTitle title={titleFor(route.name)} />,
          tabBarActiveTintColor:   BRAND_BLUE,
          tabBarInactiveTintColor: TAB_INACTIVE,
          tabBarLabelStyle:        { fontSize: 11, fontWeight: '600' },
          tabBarStyle:             { backgroundColor: '#fff', borderTopColor: '#e8e8e8' },
          tabBarIcon: ({ color }) => <TabIcon name={route.name} color={color} />,
        })}
      >
        <Tab.Screen name="Schedule" component={ScheduleScreen} options={{ title: 'Today' }} />
        <Tab.Screen name="Earnings" component={EarningsScreen} />
        <Tab.Screen
          name="Clients"
          component={ClientsStack}
          options={{ headerShown: false /* the inner stack provides its own header */ }}
        />
        <Tab.Screen
          name="Chat"
          component={ChatStack}
          options={{ headerShown: false, title: 'Messages' }}
        />
        <Tab.Screen name="Profile"  component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
