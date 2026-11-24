import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const themeOptions = [
  { id: 'system', name: 'System Default' },
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
] as const;
type Preference = typeof themeOptions[number]['id'];
type Scheme = Exclude<Preference, 'system'>;

export const tokens = {
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 6, md: 10, lg: 14 },
  font: { caption: 12, small: 14, body: 16, heading: 20, title: 32 },
  control: { minHeight: 48 },
  contentMaxWidth: 720,
  elevation: { shadowColor: '#000000', shadowOpacity: 0.12, shadowOffset: { width: 0, height: 6 }, shadowRadius: 16, elevation: 8 },
} as const;

export const palettes = {
  light: {
    bg: '#FFFFFF', secondary: '#F5F5F5', card: '#FFFFFF', text: '#111111', muted: '#666666',
    primary: '#000000', onPrimary: '#FFFFFF', border: '#E5E5E5', input: '#FAFAFA', icon: '#111111',
    red: '#A61B1B', overlay: '#00000080',
  },
  dark: {
    bg: '#000000', secondary: '#111111', card: '#171717', text: '#FFFFFF', muted: '#A3A3A3',
    primary: '#FFFFFF', onPrimary: '#000000', border: '#333333', input: '#171717', icon: '#FFFFFF',
    red: '#FF9A9A', overlay: '#000000A6',
  },
} as const;
export type Palette = typeof palettes[Scheme];

const storageKey = 'docuvault.appearance';
const Theme = createContext<{
  scheme: Scheme;
  colors: Palette;
  preference: Preference;
  setPreference: (value: Preference) => void;
  storageError: string;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreference] = useState<Preference>('system');
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const pending = useRef(Promise.resolve());

  useEffect(() => {
    let mounted = true;
    SecureStore.getItemAsync(storageKey).then(value => {
      if (mounted && (value === 'light' || value === 'dark')) setPreference(value);
    }).catch(() => {
      if (mounted) setStorageError('Your saved appearance could not be loaded.');
    }).finally(() => {
      if (mounted) setReady(true);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (ready) Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference, ready]);

  const scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const value = useMemo(() => ({
    scheme, colors: palettes[scheme], preference, storageError,
    setPreference(next: Preference) {
      setPreference(next);
      pending.current = pending.current.then(() => SecureStore.setItemAsync(storageKey, next)).then(
        () => setStorageError(''),
        () => setStorageError('Appearance changed, but your choice could not be saved. Select it again to retry.'),
      );
    },
  }), [scheme, preference, storageError]);

  return ready ? <Theme.Provider value={value}>{children}</Theme.Provider> : null;
}

export function useAppearance() {
  const theme = useContext(Theme);
  if (!theme) throw new Error('DocuVault appearance requires ThemeProvider.');
  return theme;
}
