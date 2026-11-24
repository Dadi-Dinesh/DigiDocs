import { createContext, useContext } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { User } from './api';

export type Routes = {
  Tabs: undefined;
  Login: undefined;
  Registration: undefined;
  Setup: { fullName: string; employeeId: string; email: string; password: string };
  List: { mode: 'all' | 'mine' | 'shared' | 'manage'; sensitive?: boolean };
  Details: { id: string };
  Access: { id: string };
  Versions: { id: string; download: boolean; edit: boolean };
  Preview: { id: string; number: number; fileName: string };
  Verify: { id: string; number: number };
  Edit: { id: string };
  Employees: undefined;
  Roles: undefined;
  Departments: undefined;
  Audit: undefined;
  Settings: undefined;
  Requests: undefined;
};
export const useNav = () => useNavigation<NativeStackNavigationProp<Routes>>();
export const Session = createContext<{ user: User | null; signIn: (token: string) => Promise<void>; signOut: () => Promise<void> }>({
  user: null, signIn: async () => {}, signOut: async () => {},
});
export const useSession = () => useContext(Session);
export function useUser() {
  const { user } = useSession();
  if (!user) throw new Error('An active session is required.');
  return user;
}
export const permitted = (user: User, name: string) => user.admin || user.permissions.includes(name);
