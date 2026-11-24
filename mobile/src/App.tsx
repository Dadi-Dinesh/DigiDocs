import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { get, errorMessage, onSessionExpired, restoreToken, sessionToken, send, setToken, type User } from './api';
import { LoginScreen, ProfileScreen, RegisterScreen, SettingsScreen, SetupScreen } from './account';
import { AuditScreen, DepartmentsScreen, EmployeesScreen, RolesScreen } from './admin';
import { AccessScreen, DetailsScreen, DocumentList, EditScreen, ListScreen, PreviewScreen, UploadScreen, VerifyScreen, VersionsScreen } from './documents';
import { ActivityScreen, HomeScreen, RequestsScreen } from './home';
import { Session, type Routes } from './navigation';
import { c, Icon, s, Screen, Status, type IconName } from './ui';

const Stack = createNativeStackNavigator<Routes>();
const Tab = createBottomTabNavigator<{ Home: undefined; Documents: undefined; Upload: undefined; Activity: undefined; Profile: undefined }>();
const icons: Record<string, IconName> = { Home: 'home-outline', Documents: 'folder-open-outline', Upload: 'add-circle-outline', Activity: 'pulse-outline', Profile: 'person-circle-outline' };
const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, primary: '#A5B4FC', background: c.bg, card: c.card, text: c.text, border: c.border } };

function Tabs() {
  return <Tab.Navigator screenOptions={({ route }) => ({
    headerStyle: { backgroundColor: c.bg }, headerShadowVisible: false,
    headerTitleStyle: { fontWeight: '800' }, headerTitle: route.name === 'Home' ? 'DocuVault' : route.name,
    tabBarActiveTintColor: '#A5B4FC', tabBarInactiveTintColor: c.muted,
    tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border },
    tabBarIcon: ({ color, size }) => <Icon name={icons[route.name]} color={color} size={size} />,
  })}>
    <Tab.Screen name="Home">{({ navigation }) => <HomeScreen openUpload={() => navigation.navigate('Upload')} />}</Tab.Screen>
    <Tab.Screen name="Documents" component={DocumentList} />
    <Tab.Screen name="Upload" component={UploadScreen} />
    <Tab.Screen name="Activity" component={ActivityScreen} />
    <Tab.Screen name="Profile" component={ProfileScreen} />
  </Tab.Navigator>;
}
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  const boot = useCallback(async () => {
    setStartupError('');
    setReady(false);
    try {
      const token = await restoreToken();
      if (token) setUser(await get<User>('/auth/me'));
    } catch (reason) {
      if (sessionToken()) setStartupError(errorMessage(reason));
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
  return <SafeAreaProvider>
    <StatusBar barStyle="light-content" />
    <Session.Provider value={{ user, signIn, signOut }}>
      {!ready || startupError ? <SafeAreaView style={s.screen}>
        <Screen title="DocuVault"><Status loading={!ready} error={startupError} retry={() => void boot()} /></Screen>
      </SafeAreaView> : <NavigationContainer theme={theme}>
        <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, headerShadowVisible: false, headerBackTitle: 'Back' }}>
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
            <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'DocuVault' }} />
            <Stack.Screen name="Registration" component={RegisterScreen} options={{ title: 'Registration' }} />
            <Stack.Screen name="Setup" component={SetupScreen} options={{ title: 'Registration' }} />
          </>}
        </Stack.Navigator>
      </NavigationContainer>}
    </Session.Provider>
  </SafeAreaProvider>;
}
