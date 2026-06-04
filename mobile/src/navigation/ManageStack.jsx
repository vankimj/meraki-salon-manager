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
import EmployeesScreen     from '../screens/manage/EmployeesScreen';
import MeetingsScreen      from '../screens/manage/MeetingsScreen';
import WalkinScreen        from '../screens/manage/WalkinScreen';
import ReportsScreen       from '../screens/manage/ReportsScreen';
import HRScreen            from '../screens/manage/HRScreen';
import MarketingScreen     from '../screens/manage/MarketingScreen';
import TrashScreen         from '../screens/manage/TrashScreen';
import AdminHomeScreen     from '../screens/admin/AdminHomeScreen';
import AdminLogsScreen     from '../screens/admin/AdminLogsScreen';
import AdminSettingsScreen from '../screens/admin/AdminSettingsScreen';
import AdminUsersScreen    from '../screens/admin/AdminUsersScreen';
import AdminFeedbackScreen from '../screens/admin/AdminFeedbackScreen';
import AdminIntegrityScreen from '../screens/admin/AdminIntegrityScreen';
import AdminNotifsScreen   from '../screens/admin/AdminNotifsScreen';
import AdminReviewsScreen  from '../screens/admin/AdminReviewsScreen';
import AdminOnboardingScreen from '../screens/admin/AdminOnboardingScreen';
import AdminWebfrontScreen from '../screens/admin/AdminWebfrontScreen';
import AdminSmsScreen      from '../screens/admin/AdminSmsScreen';
import AdminDemoScreen     from '../screens/admin/AdminDemoScreen';
import AdminGoogleBusinessScreen from '../screens/admin/AdminGoogleBusinessScreen';

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
      <Stack.Screen name="Employees" component={EmployeesScreen}
        options={{ headerTitle: () => <HeaderTitle title="Employees" /> }} />
      <Stack.Screen name="Meetings" component={MeetingsScreen}
        options={{ headerTitle: () => <HeaderTitle title="Meetings" /> }} />
      <Stack.Screen name="Walkin" component={WalkinScreen}
        options={{ headerTitle: () => <HeaderTitle title="Walk-in Kiosk" /> }} />
      <Stack.Screen name="Reports" component={ReportsScreen}
        options={{ headerTitle: () => <HeaderTitle title="Reports" /> }} />
      <Stack.Screen name="HR" component={HRScreen}
        options={{ headerTitle: () => <HeaderTitle title="HR" /> }} />
      <Stack.Screen name="Marketing" component={MarketingScreen}
        options={{ headerTitle: () => <HeaderTitle title="Marketing" /> }} />

      <Stack.Screen name="ManageChat"  component={ChatScreen}
        options={{ headerTitle: () => <HeaderTitle title="Messages" /> }} />
      <Stack.Screen name="ChatThread"  component={ChatThreadScreen}
        options={({ route }) => ({ headerTitle: () => <HeaderTitle title={route.params?.clientName || 'Client'} /> })} />

      <Stack.Screen name="ModulePlaceholder" component={ModulePlaceholder}
        options={({ route }) => ({ headerTitle: () => <HeaderTitle title={route.params?.label || 'Module'} /> })} />

      <Stack.Screen name="Trash" component={TrashScreen}
        options={{ headerTitle: () => <HeaderTitle title="Trash" /> }} />

      <Stack.Screen name="AdminHome" component={AdminHomeScreen}
        options={{ headerTitle: () => <HeaderTitle title="Admin" /> }} />
      <Stack.Screen name="AdminLogs" component={AdminLogsScreen}
        options={{ headerTitle: () => <HeaderTitle title="Activity Log" /> }} />
      <Stack.Screen name="AdminSettings" component={AdminSettingsScreen}
        options={{ headerTitle: () => <HeaderTitle title="Settings" /> }} />
      <Stack.Screen name="AdminUsers" component={AdminUsersScreen}
        options={{ headerTitle: () => <HeaderTitle title="Users & Roles" /> }} />
      <Stack.Screen name="AdminFeedback" component={AdminFeedbackScreen}
        options={{ headerTitle: () => <HeaderTitle title="Feedback" /> }} />
      <Stack.Screen name="AdminIntegrity" component={AdminIntegrityScreen}
        options={{ headerTitle: () => <HeaderTitle title="Data Integrity" /> }} />
      <Stack.Screen name="AdminNotifs" component={AdminNotifsScreen}
        options={{ headerTitle: () => <HeaderTitle title="Notifications" /> }} />
      <Stack.Screen name="AdminReviews" component={AdminReviewsScreen}
        options={{ headerTitle: () => <HeaderTitle title="Reviews" /> }} />
      <Stack.Screen name="AdminOnboarding" component={AdminOnboardingScreen}
        options={{ headerTitle: () => <HeaderTitle title="Onboarding" /> }} />
      <Stack.Screen name="AdminWebfront" component={AdminWebfrontScreen}
        options={{ headerTitle: () => <HeaderTitle title="Public Site" /> }} />
      <Stack.Screen name="AdminSms" component={AdminSmsScreen}
        options={{ headerTitle: () => <HeaderTitle title="SMS" /> }} />
      <Stack.Screen name="AdminDemo" component={AdminDemoScreen}
        options={{ headerTitle: () => <HeaderTitle title="Demo Data" /> }} />
      <Stack.Screen name="AdminGoogleBusiness" component={AdminGoogleBusinessScreen}
        options={{ headerTitle: () => <HeaderTitle title="Google Business" /> }} />
    </Stack.Navigator>
  );
}
