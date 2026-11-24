import React, { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { date, errorMessage, get, type Document } from './api';
import { palettes, tokens as t, useAppearance, type Palette } from './theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export function Icon({ name, color, size = 21 }: { name: IconName; color?: string; size?: number }) {
  const { colors } = useAppearance();
  return <Ionicons accessible={false} name={name} color={color ?? colors.icon} size={size} />;
}
function styles(c: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { width: '100%', maxWidth: t.contentMaxWidth, alignSelf: 'center', padding: t.space.lg, paddingBottom: t.space.xxl, gap: t.space.lg },
    heading: { gap: t.space.xs, paddingTop: t.space.sm, paddingBottom: t.space.xs },
    title: { color: c.text, fontSize: t.font.title, fontWeight: '700', letterSpacing: -1.1 },
    section: { color: c.text, fontSize: t.font.heading, fontWeight: '700', letterSpacing: -0.35 },
    text: { color: c.text, fontSize: t.font.body, lineHeight: 23 },
    muted: { color: c.muted, fontSize: t.font.small, lineHeight: 21 },
    panel: { padding: t.space.lg, gap: t.space.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: t.radius.lg },
    inset: { backgroundColor: c.secondary },
    row: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
    fill: { flex: 1 },
    field: { color: c.text, backgroundColor: c.input, paddingHorizontal: t.space.md, paddingVertical: t.space.md, ...t.control, borderWidth: 1, borderColor: c.border, borderRadius: t.radius.md, fontSize: t.font.body },
    label: { color: c.muted, fontWeight: '600', fontSize: t.font.small },
    button: { ...t.control, paddingHorizontal: t.space.lg, paddingVertical: t.space.md, borderRadius: t.radius.md, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
    buttonLabel: { fontSize: t.font.small, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
    badge: { backgroundColor: c.secondary, color: c.text, borderRadius: t.radius.sm, paddingHorizontal: t.space.sm, paddingVertical: t.space.xs, alignSelf: 'flex-start', fontSize: t.font.caption, fontWeight: '600' },
    error: { color: c.red, fontSize: t.font.small, lineHeight: 21 },
    mono: { color: c.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: t.font.caption },
    tile: { width: 48, height: 48, borderRadius: t.radius.md, backgroundColor: c.secondary, alignItems: 'center', justifyContent: 'center' },
    dialogBackdrop: { flex: 1, justifyContent: 'center', padding: t.space.xl, backgroundColor: c.overlay },
    dialog: { width: '100%', maxWidth: 420, alignSelf: 'center', ...t.elevation },
  });
}
const themeStyles = { light: styles(palettes.light), dark: styles(palettes.dark) };

export function useUI() {
  const theme = useAppearance();
  return { ...theme, c: theme.colors, s: themeStyles[theme.scheme] };
}

export function Screen({ children, title, subtitle, refresh, refreshing = false, compact = false, topInset = false }: {
  children: ReactNode; title?: string; subtitle?: string; refresh?: () => void; refreshing?: boolean; compact?: boolean; topInset?: boolean;
}) {
  const { c, s } = useUI();
  return <SafeAreaView style={s.screen} edges={topInset ? ['left', 'right', 'top'] : ['left', 'right']}>
    <ScrollView contentContainerStyle={[s.content, compact && { maxWidth: 480 }]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
      refreshControl={refresh && <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.icon}
        colors={[c.icon]} progressBackgroundColor={c.card} />}>
      {(title || subtitle) && <View style={s.heading}>
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
  const { c, s } = useUI();
  const outlined = secondary || danger;
  const color = danger ? c.red : outlined ? c.text : c.onPrimary;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, {
      backgroundColor: outlined ? (pressed ? c.secondary : c.card) : c.primary,
      borderColor: outlined ? c.border : c.primary,
      opacity: disabled ? 0.45 : pressed && !outlined ? 0.78 : 1,
    }]}>
    <View style={s.row}>{icon && <Icon name={icon} color={color} size={18} />}
      <Text style={[s.buttonLabel, { color }]}>{title}</Text>
    </View>
  </Pressable>;
}

export function Field({ label, icon, onFocus, onBlur, style, ...props }: TextInputProps & { label: string; icon?: IconName }) {
  const { c, s, scheme } = useUI();
  const [focused, setFocused] = useState(false);
  return <View style={{ gap: t.space.sm }}>
    <Text style={s.label}>{label}</Text>
    <View style={[s.row, s.field, focused && { borderColor: c.text }, { paddingVertical: 0 }]}>
      {icon && <Icon name={icon} size={18} />}
      <TextInput keyboardAppearance={scheme} underlineColorAndroid="transparent" {...props} accessibilityLabel={label}
        placeholderTextColor={c.muted} selectionColor={c.muted} selectionHandleColor={c.text} cursorColor={c.text}
        onFocus={event => { setFocused(true); onFocus?.(event); }}
        onBlur={event => { setFocused(false); onBlur?.(event); }}
        style={[s.fill, { color: c.text, minHeight: t.control.minHeight - 2, paddingVertical: t.space.md, fontSize: t.font.body },
          props.multiline && { minHeight: 88, textAlignVertical: 'top' }, style]} />
    </View>
  </View>;
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { c } = useUI();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={{
    borderWidth: 1, borderColor: selected ? c.primary : c.border, borderRadius: t.radius.md,
    backgroundColor: selected ? c.primary : c.card, paddingHorizontal: t.space.md, paddingVertical: t.space.sm, minHeight: 44,
    maxWidth: '100%', justifyContent: 'center',
  }}><Text style={{ color: selected ? c.onPrimary : c.text, fontSize: t.font.small, fontWeight: '600' }}>{label}</Text></Pressable>;
}

export function Choices<T extends string>({ label, options, value, select }: {
  label: string; options: readonly { id: T; name: string }[]; value: T; select: (id: T) => void;
}) {
  const { s } = useUI();
  return <View style={{ gap: t.space.sm }}><Text style={s.label}>{label}</Text><View style={s.wrap}>
    {options.map(item => <Chip key={item.id} selected={value === item.id} label={item.name} onPress={() => select(item.id)} />)}
  </View></View>;
}

export function FileIcon({ fileName }: { fileName: string }) {
  const { s } = useUI();
  const ext = fileName.split('.').pop()?.toUpperCase() ?? '';
  const icon = ['PNG', 'JPG', 'JPEG'].includes(ext) ? 'image-outline' : ext === 'XLSX' ? 'grid-outline' : 'document-text-outline';
  return <View style={s.tile}>
    <Icon name={icon} size={18} />
    <Text allowFontScaling={false} style={[s.label, { fontSize: 9 }]}>{ext.slice(0, 5)}</Text>
  </View>;
}

export function DocumentCard({ doc, open }: { doc: Document; open: () => void }) {
  const { c, s } = useUI();
  return <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => [s.panel, s.row, pressed && s.inset]}>
    <FileIcon fileName={doc.version.fileName} />
    <View style={[s.fill, { gap: t.space.xs }]}>
      <Text style={[s.text, { fontWeight: '700' }]} numberOfLines={2}>{doc.title}</Text>
      <Text style={s.muted} numberOfLines={1}>{doc.folder} · {date(doc.version.createdAt)}</Text>
      <Text style={s.badge}>{doc.classification}</Text>
    </View>
    <Icon name="chevron-forward" color={c.muted} size={17} />
  </Pressable>;
}

type Dialog = { title: string; body: string; proceed?: () => void; destructive?: boolean };
const DialogContext = createContext<((dialog: Dialog) => void) | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const { s } = useUI();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  return <DialogContext.Provider value={setDialog}>
    {children}
    <Modal visible={!!dialog} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={close}>
      {dialog && <View style={s.dialogBackdrop}>
        <View accessibilityViewIsModal style={[s.panel, s.dialog]}>
          <Text accessibilityRole="header" style={s.section}>{dialog.title}</Text>
          <Text style={s.muted}>{dialog.body}</Text>
          {dialog.proceed && <Button secondary title="Cancel" onPress={close} />}
          <Button danger={dialog.destructive} title={dialog.proceed ? 'Confirm' : 'Done'} onPress={() => {
            close();
            dialog.proceed?.();
          }} />
        </View>
      </View>}
    </Modal>
  </DialogContext.Provider>;
}

export function useDialog() {
  const show = useContext(DialogContext);
  if (!show) throw new Error('DocuVault dialogs require DialogProvider.');
  return {
    inform: (title: string, body: string) => show({ title, body }),
    confirm: (title: string, body: string, proceed: () => void, destructive = false) =>
      show({ title, body, proceed, destructive }),
  };
}

export function useLoad<T>(path: string | null) {
  const [result, setResult] = useState<{ path: string | null; data?: T; error?: string }>({ path: null });
  const [generation, setGeneration] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const reload = useCallback(() => {
    if (!path) return;
    setRefreshing(true);
    setGeneration(value => value + 1);
  }, [path]);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (!path) return;
    get<T>(path).then(
      data => { if (active) setResult({ path, data }); },
      reason => { if (active) setResult({ path, error: errorMessage(reason) }); },
    ).finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [path, generation]));
  const current = result.path === path ? result : { data: undefined, error: undefined };
  return { data: current.data, error: current.error, loading: Boolean(path && !current.data && !current.error), refreshing, reload };
}
export function Status({ loading, error, retry, empty }: { loading?: boolean; error?: string; retry?: () => void; empty?: string }) {
  const { c, s } = useUI();
  if (loading) return <ActivityIndicator color={c.icon} style={{ margin: 14 }} />;
  if (error) return <View style={s.panel}><Text accessibilityRole="alert" style={s.error}>{error}</Text>{retry && <Button title="Try again" secondary onPress={retry} />}</View>;
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
