import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ClientsScreen      from '../screens/ClientsScreen';
import ClientDetailScreen from '../screens/ClientDetailScreen';
import TrashScreen        from '../screens/manage/TrashScreen';
import HeaderTitle        from '../components/HeaderTitle';
import { useTheme }       from '../theme/ThemeContext';

const Stack = createNativeStackNavigator();

// Clients tab gets its own stack so we can drill into a client's
// profile with a real back button and screen transition. ClientsList
// is the tab's root; tapping a row navigates to ClientDetail.
//
// Each screen gets the same 2-line HeaderTitle as the root tabs
// (screen name on top, current salon name beneath) so multi-tenant
// users keep seeing which salon they're scoped to even when drilled
// into a sub-screen.
export default function ClientsStack() {
  const { theme } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle:      { backgroundColor: theme.headerBg },
        headerTintColor:  theme.green,
        contentStyle:     { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen
        name="ClientsList"
        component={ClientsScreen}
        options={{ headerTitle: () => <HeaderTitle title="Clients" /> }}
      />
      <Stack.Screen
        name="ClientDetail"
        component={ClientDetailScreen}
        options={({ route }) => ({ headerTitle: () => <HeaderTitle title={route.params?.clientName || 'Client'} /> })}
      />
      <Stack.Screen
        name="Trash"
        component={TrashScreen}
        options={{ headerTitle: () => <HeaderTitle title="Trash" /> }}
      />
    </Stack.Navigator>
  );
}
