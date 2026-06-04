import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ScheduleScreen from '../screens/ScheduleScreen';
import TrashScreen    from '../screens/manage/TrashScreen';
import CheckoutScreen from '../screens/checkout/CheckoutScreen';
import HeaderTitle    from '../components/HeaderTitle';
import { useTheme }   from '../theme/ThemeContext';

const Stack = createNativeStackNavigator();

// Schedule gets its own stack so the calendar can push a scoped Trash
// screen (deleted appointments + time off) with a real back button.
export default function ScheduleStack() {
  const { theme } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{ headerStyle: { backgroundColor: theme.headerBg }, headerTintColor: theme.green, contentStyle: { backgroundColor: theme.bg } }}
    >
      <Stack.Screen name="ScheduleHome" component={ScheduleScreen}
        options={{ headerTitle: () => <HeaderTitle title="Today" /> }} />
      <Stack.Screen name="Trash" component={TrashScreen}
        options={{ headerTitle: () => <HeaderTitle title="Trash" /> }} />
      <Stack.Screen name="Checkout" component={CheckoutScreen}
        options={{ headerTitle: () => <HeaderTitle title="Checkout" /> }} />
    </Stack.Navigator>
  );
}
