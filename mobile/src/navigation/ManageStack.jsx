import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HeaderTitle         from '../components/HeaderTitle';
import ManageGridScreen    from '../screens/manage/ManageGridScreen';
import ModulePlaceholder   from '../screens/manage/ModulePlaceholder';
import ChatScreen          from '../screens/ChatScreen';
import ChatThreadScreen    from '../screens/ChatThreadScreen';
import ServicesScreen      from '../screens/manage/ServicesScreen';
import ProductsScreen      from '../screens/manage/ProductsScreen';
import AttendanceScreen    from '../screens/manage/AttendanceScreen';
import GiftCardsScreen     from '../screens/manage/GiftCardsScreen';
import MembershipsScreen   from '../screens/manage/MembershipsScreen';

const Stack = createNativeStackNavigator();

// The Manage tab (replaces the old Chat tab). Root is the tile grid;
// each built module pushes its own screen. Chat (Communications) now
// lives here as a pushed screen instead of a dedicated bottom tab.
export default function ManageStack() {
  return (
    <Stack.Navigator
      screenOptions={{ headerStyle: { backgroundColor: '#fff' }, headerTintColor: '#2D7A5F' }}
    >
      <Stack.Screen name="ManageGrid"  component={ManageGridScreen}
        options={{ headerTitle: () => <HeaderTitle title="Manage" /> }} />

      <Stack.Screen name="Services"    component={ServicesScreen}
        options={{ headerTitle: () => <HeaderTitle title="Services" /> }} />
      <Stack.Screen name="Products"    component={ProductsScreen}
        options={{ headerTitle: () => <HeaderTitle title="Products" /> }} />
      <Stack.Screen name="Attendance"  component={AttendanceScreen}
        options={{ headerTitle: () => <HeaderTitle title="Attendance" /> }} />
      <Stack.Screen name="GiftCards"   component={GiftCardsScreen}
        options={{ headerTitle: () => <HeaderTitle title="Gift Cards" /> }} />
      <Stack.Screen name="Memberships" component={MembershipsScreen}
        options={{ headerTitle: () => <HeaderTitle title="Memberships" /> }} />

      <Stack.Screen name="ManageChat"  component={ChatScreen}
        options={{ headerTitle: () => <HeaderTitle title="Messages" /> }} />
      <Stack.Screen name="ChatThread"  component={ChatThreadScreen}
        options={({ route }) => ({ headerTitle: () => <HeaderTitle title={route.params?.clientName || 'Client'} /> })} />

      <Stack.Screen name="ModulePlaceholder" component={ModulePlaceholder}
        options={({ route }) => ({ headerTitle: () => <HeaderTitle title={route.params?.label || 'Module'} /> })} />
    </Stack.Navigator>
  );
}
