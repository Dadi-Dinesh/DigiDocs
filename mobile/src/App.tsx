import { useCallback, useEffect, useState } from 'react';
import { Platform, StatusBar } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { get, errorMessage, onSessionExpired, restoreToken, sessionToken, send, setToken, type User } from './api';
import { LoginScreen, ProfileScreen, RegisterScreen, SettingsScreen, SetupScreen } from './account';
import { AuditScreen, DepartmentsScreen, EmployeesScreen, RolesScreen } from './admin';
import { AccessScreen, DetailsScreen, DocumentList, EditScreen, ListScreen, PreviewScreen, UploadScreen, VerifyScreen, VersionsScreen } from './documents';
import { ActivityScreen, HomeScreen, RequestsScreen } from './home';
import { permitted, Session, useUser, type Routes } from './navigation';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import * as NavigationBar from 'expo-navigation-bar';
import { DialogProvider, Icon, Screen, Status, useUI, type IconName } from './ui';
import { ThemeProvider } from './theme';

void SplashScreen.preventAutoHideAsync().catch(() => {});

const Stack = createNativeStackNavigator<Routes>();
const Tab = createBottomTabNavigator<{ Home: undefined; Documents: undefined; Upload: undefined; Activity: undefined; Profile: undefined }>();
const icons: Record<string, IconName> = { Home: 'home-outline', Documents: 'folder-open-outline', Upload: 'add-circle-outline', Activity: 'pulse-outline', Profile: 'person-circle-outline' };

function Tabs() {
  const { c } = useUI();
  const canUpload = permitted(useUser(), 'upload');
  return <Tab.Navigator screenOptions={({ route }) => ({
    headerStyle: { backgroundColor: c.bg }, headerShadowVisible: false,
    headerTitleStyle: { fontWeight: '800' }, headerTitle: route.name === 'Home' ? 'DocuVault' : route.name,
    tabBarActiveTintColor: c.text, tabBarInactiveTintColor: c.muted,
    tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border },
    tabBarActiveBackgroundColor: c.secondary,
    tabBarLabelStyle: { fontWeight: '600' },
    tabBarIcon: ({ color, size }) => <Icon name={icons[route.name]} color={color} size={size} />,
  })}>
    <Tab.Screen name="Home">{({ navigation }) => <HomeScreen openUpload={() => { if (canUpload) navigation.navigate('Upload'); }} />}</Tab.Screen>
    <Tab.Screen name="Documents">{({ navigation }) =>
      <DocumentList openUpload={canUpload ? () => navigation.navigate('Upload') : undefined} />
    }</Tab.Screen>
    {canUpload && <Tab.Screen name="Upload" component={UploadScreen} />}
    <Tab.Screen name="Activity" component={ActivityScreen} />
    <Tab.Screen name="Profile" component={ProfileScreen} />
  </Tab.Navigator>;
}
export default function App() {
  return <ThemeProvider><SafeAreaProvider><DialogProvider><AppNavigation /></DialogProvider></SafeAreaProvider></ThemeProvider>;
}

function AppNavigation() {
  const { c, s, scheme } = useUI();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { primary: c.primary, background: c.bg, card: c.card, text: c.text, border: c.border, notification: c.text } };
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.bg).catch(() => {});
    if (Platform.OS === 'android') NavigationBar.setStyle(scheme);
  }, [c.bg, scheme]);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  const boot = useCallback(async () => {
    setStartupError('');
    setReady(false);
    let restoring = true;
    try {
      const token = await restoreToken();
      restoring = false;
      if (token) setUser(await get<User>('/auth/me'));
    } catch (reason) {
      if (restoring || sessionToken()) setStartupError(errorMessage(reason));
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    onSessionExpired(() => setUser(null));
    void boot();
    return () => onSessionExpired();
  }, [boot]);
  const signIn = async (token: string) => {
    await setToken(token);
    try { setUser(await get<User>('/auth/me')); } catch (reason) { await setToken(null); throw reason; }
  };
  const signOut = async () => {
    await send('POST', '/auth/logout');
    await setToken(null);
    setUser(null);
  };
  const onLayout = useCallback(() => { void SplashScreen.hideAsync().catch(() => {}); }, []);
  return <SafeAreaView edges={[]} style={s.screen} onLayout={onLayout}>
    <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
    <Session.Provider value={{ user, signIn, signOut }}>
      {!ready || startupError ? <SafeAreaView style={s.screen}>
        <Screen title="DocuVault"><Status loading={!ready} error={startupError} retry={() => void boot()} /></Screen>
      </SafeAreaView> : <NavigationContainer theme={theme}>
        <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, headerTitleStyle: { fontWeight: '700' }, contentStyle: { backgroundColor: c.bg }, headerShadowVisible: false, headerBackTitle: 'Back' }}>
          {user ? <>
            <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
            <Stack.Screen name="List" component={ListScreen} options={{ title: 'Documents' }} />
            <Stack.Screen name="Details" component={DetailsScreen} options={{ title: 'Document' }} />
            <Stack.Screen name="Edit" component={EditScreen} options={{ title: 'Document' }} />
            <Stack.Screen name="Access" component={AccessScreen} options={{ title: 'Document permissions' }} />
            <Stack.Screen name="Versions" component={VersionsScreen} options={{ title: 'Document versions' }} />
            <Stack.Screen name="Preview" component={PreviewScreen} options={{ title: 'Document' }} />
            <Stack.Screen name="Verify" component={VerifyScreen} options={{ title: 'Integrity' }} />
            <Stack.Screen name="Employees" component={EmployeesScreen} options={{ title: 'Organization' }} />
            <Stack.Screen name="Roles" component={RolesScreen} options={{ title: 'Organization' }} />
            <Stack.Screen name="Departments" component={DepartmentsScreen} options={{ title: 'Organization' }} />
            <Stack.Screen name="Audit" component={AuditScreen} options={{ title: 'Activity' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Account' }} />
            <Stack.Screen name="Requests" component={RequestsScreen} options={{ title: 'Activity' }} />
          </> : <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Registration" component={RegisterScreen} options={{ title: 'Registration' }} />
            <Stack.Screen name="Setup" component={SetupScreen} options={{ title: 'Registration' }} />
          </>}
        </Stack.Navigator>
      </NavigationContainer>}
    </Session.Provider>
  </SafeAreaView>;
}
