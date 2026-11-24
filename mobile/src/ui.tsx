import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { date, errorMessage, get, type Document } from './api';

export const c = { bg: '#0B1020', card: '#151D30', accent: '#6475F5', violet: '#8B5CF6', green: '#22C55E', text: '#F8FAFC', muted: '#94A3B8', border: '#263249', red: '#FCA5A5' };
export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export const Icon = ({ name, color = c.muted, size = 21 }: { name: IconName; color?: string; size?: number }) => <Ionicons name={name} color={color} size={size} />;

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { padding: 20, paddingBottom: 38, gap: 16 },
  title: { color: c.text, fontSize: 31, fontWeight: '800', letterSpacing: -0.9 },
  section: { color: c.text, fontSize: 18, fontWeight: '700' },
  text: { color: c.text, fontSize: 15 },
  muted: { color: c.muted, fontSize: 14, lineHeight: 21 },
  panel: { padding: 16, gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fill: { flex: 1 },
  field: { color: c.text, backgroundColor: c.bg, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, borderWidth: 1, borderColor: c.border, borderRadius: 12, fontSize: 16 },
  label: { color: c.muted, fontWeight: '600', fontSize: 13 },
  button: { minHeight: 48, padding: 12, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  badge: { backgroundColor: '#262C51', color: '#C8CFFF', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start', fontSize: 12, fontWeight: '600' },
  error: { color: c.red, lineHeight: 20 },
  mono: { color: '#C8CFFF', fontFamily: 'Courier', fontSize: 13 },
});

export function Screen({ children, title, subtitle, refresh }: {
  children: React.ReactNode; title?: string; subtitle?: string; refresh?: () => void;
}) {
  return <SafeAreaView style={s.screen} edges={['left', 'right']}>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
      refreshControl={refresh && <RefreshControl refreshing={false} onRefresh={refresh} tintColor={c.accent} />}>
      {(title || subtitle) && <View style={{ gap: 5, marginBottom: 2 }}>
        {!!title && <Text style={s.title} accessibilityRole="header">{title}</Text>}
        {!!subtitle && <Text style={s.muted}>{subtitle}</Text>}
      </View>}
      {children}
    </ScrollView>
  </SafeAreaView>;
}
export function Button({ title, onPress, secondary, danger, disabled, icon }: {
  title: string; onPress: () => void; secondary?: boolean; danger?: boolean; disabled?: boolean; icon?: IconName;
}) {
  const color = danger ? c.red : c.text;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, { backgroundColor: secondary || danger ? c.card : '#4657CC', borderColor: secondary || danger ? c.border : '#6677F6', opacity: pressed || disabled ? 0.56 : 1 }]}>
    <View style={s.row}>{icon && <Icon name={icon} color={color} size={18} />}<Text style={{ color, fontSize: 15, fontWeight: '700' }}>{title}</Text></View>
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={{ gap: 6 }}><Text style={s.label}>{label}</Text>
    <TextInput {...props} accessibilityLabel={label} placeholderTextColor={c.muted} style={[s.field, props.multiline && { minHeight: 80, textAlignVertical: 'top' }]} />
  </View>;
}
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={{
    borderWidth: 1, borderColor: selected ? c.accent : c.border, borderRadius: 10, backgroundColor: selected ? '#292F5A' : c.bg, paddingHorizontal: 12, minHeight: 42, justifyContent: 'center',
  }}><Text style={{ color: selected ? c.text : c.muted, fontWeight: '600' }}>{label}</Text></Pressable>;
}
export function Choices<T extends string>({ label, options, value, select }: {
  label: string; options: readonly { id: T; name: string }[]; value: T; select: (id: T) => void;
}) {
  return <View style={{ gap: 8 }}><Text style={s.label}>{label}</Text><View style={s.wrap}>
    {options.map(item => <Chip key={item.id} selected={value === item.id} label={item.name} onPress={() => select(item.id)} />)}
  </View></View>;
}
export function DocumentCard({ doc, open }: { doc: Document; open: () => void }) {
  const ext = doc.version.fileName.split('.').pop()?.toUpperCase();
  const color = ext === 'PDF' ? '#FDA4AF' : ext === 'XLSX' ? '#6EE7B7' : '#A5B4FC';
  return <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => [s.panel, s.row, { opacity: pressed ? 0.65 : 1 }]}>
    <View style={{ width: 50, height: 54, backgroundColor: '#212B43', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="document-text-outline" color={color} size={21} /><Text style={{ color, fontSize: 9, fontWeight: '800' }}>{ext}</Text>
    </View>
    <View style={[s.fill, { gap: 3 }]}>
      <Text style={[s.text, { fontWeight: '700' }]} numberOfLines={2}>{doc.title}</Text>
      <Text style={s.muted} numberOfLines={1}>{doc.folder} · {date(doc.version.createdAt)}</Text>
      <Text style={s.badge}>{doc.classification}</Text>
    </View>
    <Icon name="chevron-forward" size={16} />
  </Pressable>;
}

export function useLoad<T>(path: string | null) {
  const [result, setResult] = useState<{ path: string | null; data?: T; error?: string }>({ path: null });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration(value => value + 1), []);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (!path) return;
    get<T>(path).then(
      data => { if (active) setResult({ path, data }); },
      reason => { if (active) setResult({ path, error: errorMessage(reason) }); },
    );
    return () => { active = false; };
  }, [path, generation]));
  const current = result.path === path ? result : { data: undefined, error: undefined };
  return { data: current.data, error: current.error, loading: Boolean(path && !current.data && !current.error), reload };
}
export function Status({ loading, error, retry, empty }: { loading?: boolean; error?: string; retry?: () => void; empty?: string }) {
  if (loading) return <ActivityIndicator color={c.accent} style={{ margin: 14 }} />;
  if (error) return <View style={s.panel}><Text style={s.error}>{error}</Text>{retry && <Button title="Try again" secondary onPress={retry} />}</View>;
  if (empty) return <View style={s.panel}><Text style={s.muted}>{empty}</Text></View>;
  return null;
}
export function useMutation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await task(); } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  return { busy, error, run };
}
export function confirm(title: string, body: string, proceed: () => void, destructive = false) {
  Alert.alert(title, body, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', style: destructive ? 'destructive' : 'default', onPress: proceed }]);
}
