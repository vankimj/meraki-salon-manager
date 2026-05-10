import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import ScheduleScreen from '../screens/ScheduleScreen';
import ClientsScreen  from '../screens/ClientsScreen';
import EarningsScreen from '../screens/EarningsScreen';
import ChatScreen     from '../screens/ChatScreen';
import ProfileScreen  from '../screens/ProfileScreen';
import usePushRegistration from '../hooks/usePushRegistration';

const Tab = createBottomTabNavigator();

const BRAND_GREEN  = '#2D7A5F';
const BRAND_BLUE   = '#3D95CE';
const TAB_INACTIVE = '#9aa3ad';

// Inline emoji icons keep us off external icon libraries for now —
// Phase 4 will swap to react-native-svg branded icons.
const ICONS = {
  Schedule: '📅',
  Earnings: '💰',
  Clients:  '👥',
  Chat:     '💬',
  Profile:  '👤',
};

function TabIcon({ name, focused }) {
  return (
    <Text style={{ fontSize: focused ? 22 : 20, opacity: focused ? 1 : 0.7 }}>
      {ICONS[name]}
    </Text>
  );
}

export default function RootNav() {
  // Register the device for push as soon as the user is signed in. No-op on
  // simulators / unsupported devices; failures are swallowed (push is a
  // value-add, not a blocker for sign-in).
  usePushRegistration();

  return (
    <NavigationContainer>
      <Tab.Navigator
        initialRouteName="Schedule"
        screenOptions={({ route }) => ({
          headerStyle:     { backgroundColor: '#fff' },
          headerTintColor: BRAND_GREEN,
          headerTitleStyle:{ fontWeight: '700', fontSize: 16 },
          tabBarActiveTintColor:   BRAND_BLUE,
          tabBarInactiveTintColor: TAB_INACTIVE,
          tabBarLabelStyle:        { fontSize: 11, fontWeight: '600' },
          tabBarStyle:             { backgroundColor: '#fff', borderTopColor: '#e8e8e8' },
          tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
        })}
      >
        <Tab.Screen name="Schedule" component={ScheduleScreen} options={{ title: 'Today' }} />
        <Tab.Screen name="Earnings" component={EarningsScreen} />
        <Tab.Screen name="Clients"  component={ClientsScreen} />
        <Tab.Screen name="Chat"     component={ChatScreen} options={{ title: 'Messages' }} />
        <Tab.Screen name="Profile"  component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
