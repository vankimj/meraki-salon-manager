import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ScheduleScreen from '../screens/ScheduleScreen';
import TrashScreen    from '../screens/manage/TrashScreen';
import HeaderTitle    from '../components/HeaderTitle';

const Stack = createNativeStackNavigator();

// Schedule gets its own stack so the calendar can push a scoped Trash
// screen (deleted appointments + time off) with a real back button.
export default function ScheduleStack() {
  return (
    <Stack.Navigator
      screenOptions={{ headerStyle: { backgroundColor: '#fff' }, headerTintColor: '#2D7A5F' }}
    >
      <Stack.Screen name="ScheduleHome" component={ScheduleScreen}
        options={{ headerTitle: () => <HeaderTitle title="Today" /> }} />
      <Stack.Screen name="Trash" component={TrashScreen}
        options={{ headerTitle: () => <HeaderTitle title="Trash" /> }} />
    </Stack.Navigator>
  );
}
