import { useState } from 'react';
import { Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { date, send, type Organization, type User } from './api';
import { themeOptions, tokens, useAppearance } from './theme';
import { permitted, useNav, useSession, useUser, type Routes } from './navigation';
import { Button, Choices, Field, Icon, Screen, Status, useLoad, useMutation, useUI, useDialog } from './ui';

type Credentials = Routes['Setup'];
const organizationCode = /^[a-z0-9][a-z0-9-]{1,49}$/i;
const workEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function Brand() {
  const { s } = useUI();
  return <View style={[s.heading, { gap: tokens.space.md, marginTop: tokens.space.xl }]}>
    <View style={s.tile}>
      <Icon name="shield-checkmark-outline" size={32} />
    </View>
    <Text style={s.title}>DocuVault</Text>
    <Text style={s.muted}>Your organization’s secure document vault</Text>
  </View>;
}
export function LoginScreen() {
  const { s } = useUI();
  const [slug, setSlug] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const mutation = useMutation();
  const nav = useNav();
  const { signIn } = useSession();
  return <Screen compact topInset><Brand /><View style={s.panel}>
    <Text style={s.section}>Sign in</Text>
    <Field label="Organization code" autoCapitalize="none" autoCorrect={false} value={slug} onChangeText={setSlug} />
    <Field label="Email or Employee ID" autoCapitalize="none" autoCorrect={false} autoComplete="username" maxLength={254} value={identifier} onChangeText={setIdentifier} />
    <Field label="Password" autoComplete="current-password" secureTextEntry value={password} onChangeText={setPassword} />
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    <Button title={mutation.busy ? 'Signing in…' : 'Sign in'} icon="arrow-forward" disabled={mutation.busy || !slug.trim() || !identifier.trim() || !password} onPress={() => void mutation.run(async () => {
      const login = identifier.trim();
      if (!organizationCode.test(slug.trim())) throw new Error('Enter a valid organization code.');
      const account = workEmail.test(login) ? { email: login } : { employeeId: login };
      const result = await send<{ token: string }>('POST', '/auth/login', { slug, ...account, password });
      await signIn(result.token);
    })} />
  </View><Button secondary title="Register an organization" onPress={() => nav.navigate('Registration')} /></Screen>;
}
export function RegisterScreen() {
  const { s } = useUI();
  const [fullName, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const nav = useNav();
  const details: Credentials = { fullName, employeeId, email: email.trim(), password };
  const [validationError, setValidationError] = useState('');
  return <Screen compact title="Create your account" subtitle="Register as the administrator for a new organization.">
    <Field label="Full name" value={fullName} onChangeText={setName} />
    <Field label="Employee ID" value={employeeId} onChangeText={setEmployeeId} autoCapitalize="characters" />
    <Field label="Work email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
    <Field label="Password (12+ characters)" autoComplete="new-password" value={password} onChangeText={setPassword} secureTextEntry />
    {!!validationError && <Text style={s.error}>{validationError}</Text>}
    <Button title="Continue to organization setup" disabled={!fullName.trim() || !employeeId.trim() || !email.trim() || password.length < 12} onPress={() => {
      if (!workEmail.test(details.email)) {
        setValidationError('Enter a valid work email address.');
        return;
      }
      setValidationError('');
      nav.navigate('Setup', details);
    }} />
  </Screen>;
}
export function SetupScreen({ route }: NativeStackScreenProps<Routes, 'Setup'>) {
  const { s } = useUI();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const mutation = useMutation();
  const { signIn } = useSession();
  return <Screen compact title="Organization setup" subtitle="Employees will use your organization code when they sign in.">
    <Field label="Organization name" value={name} onChangeText={setName} />
    <Field label="Organization code" value={slug} onChangeText={setSlug} placeholder="acme-finance" autoCapitalize="none" autoCorrect={false} />
    <Field label="Description" value={description} onChangeText={setDescription} multiline />
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    <Button title={mutation.busy ? 'Creating…' : 'Create organization'} disabled={mutation.busy || !name.trim() || !slug.trim()} onPress={() => void mutation.run(async () => {
      if (!organizationCode.test(slug.trim())) {
        throw new Error('Use 2–50 letters, numbers, or hyphens for the organization code. Start with a letter or number.');
      }
      const result = await send<{ token: string }>('POST', '/auth/register', { ...route.params, name, slug, description });
      await signIn(result.token);
    })} />
  </Screen>;
}
export function ProfileScreen() {
  const { s } = useUI();
  const { confirm } = useDialog();
  const sessionUser = useUser();
  const profile = useLoad<User>('/auth/me');
  const user = profile.data ?? sessionUser;
  const nav = useNav();
  const org = useLoad<Organization>('/organization');
  const { signOut } = useSession();
  const mutation = useMutation();
  const details = [
    { label: 'Employee ID', value: user.employeeId },
    { label: 'Email', value: user.email },
    { label: 'Department', value: user.departmentName ?? 'Unassigned' },
    { label: 'Role', value: user.roleName ?? 'Unassigned' },
  ];
  return <Screen title="Profile" refresh={() => { profile.reload(); org.reload(); }} refreshing={profile.refreshing || org.refreshing}>
    <View style={s.panel}>
      <View style={s.row}>
        <View style={s.tile}><Icon name="person-outline" size={23} /></View>
        <View style={s.fill}>
          <Text style={s.section}>{user.fullName}</Text>
          <Text style={s.muted}>{user.designation}</Text>
        </View>
      </View>
    </View>
    <View style={s.panel}>
      <Text style={s.section}>Account details</Text>
      {details.map(({ label, value }) => <View key={label}>
        <Text style={s.label}>{label}</Text>
        <Text selectable style={s.text}>{value}</Text>
      </View>)}
      <View>
        <Text style={s.label}>Account status</Text>
        <Text style={s.badge}>{user.active ? 'Active' : 'Inactive'}</Text>
      </View>
      <Text style={s.muted}>Joined {date(user.joiningDate)}</Text>
    </View>
    <Status error={profile.error} retry={profile.reload} />
    <Status {...org} retry={org.reload} />
    {org.data && <View style={s.panel}>
      <Text style={s.section}>{org.data.name}</Text><Text selectable style={s.mono}>{org.data.slug}</Text>
      {!!org.data.description && <Text style={s.muted}>{org.data.description}</Text>}
    </View>}
    {permitted(user, 'manageEmployees') && <Button secondary title="Employees" icon="people-outline" onPress={() => nav.navigate('Employees')} />}
    {user.admin && <>
      <Button secondary title="Roles" icon="key-outline" onPress={() => nav.navigate('Roles')} />
      <Button secondary title="Departments" icon="business-outline" onPress={() => nav.navigate('Departments')} />
    </>}
    <Button secondary title="Settings" icon="settings-outline" onPress={() => nav.navigate('Settings')} />
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    <Button danger title={mutation.busy ? 'Logging out…' : 'Log out'} disabled={mutation.busy} icon="log-out-outline" onPress={() =>
      confirm('Log out?', 'This ends your current DocuVault session.', () => void mutation.run(signOut))} />
  </Screen>;
}

function OrganizationForm({ organization, reload }: { organization: Organization; reload: () => void }) {
  const { s } = useUI();
  const [name, setName] = useState(organization.name);
  const [description, setDescription] = useState(organization.description);
  const [saved, setSaved] = useState(false);
  const mutation = useMutation();
  return <View style={s.panel}>
    <Text style={s.section}>Organization details</Text>
    <Field label="Organization name" value={name} onChangeText={value => { setSaved(false); setName(value); }} />
    <Field label="Description" value={description} onChangeText={value => { setSaved(false); setDescription(value); }} multiline />
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    {saved && <Text style={s.text}>Organization details saved.</Text>}
    <Button secondary title={mutation.busy ? 'Saving…' : 'Save organization'} disabled={mutation.busy || !name.trim()} onPress={() => void mutation.run(async () => {
      await send('PATCH', '/organization', { name, description });
      setSaved(true);
      reload();
    })} />
  </View>;
}
export function SettingsScreen() {
  const { preference, setPreference, storageError } = useAppearance();
  const { s } = useUI();
  const { confirm } = useDialog();
  const user = useUser();
  const organization = useLoad<Organization>(user.admin ? '/organization' : null);
  const [current, setCurrent] = useState('');
  const [replacement, setReplacement] = useState('');
  const [saved, setSaved] = useState(false);
  const mutation = useMutation();
  return <Screen title="Settings">
    <View style={s.panel}>
      <Text style={s.section}>Appearance</Text>
      <Choices label="Theme" options={themeOptions} value={preference} select={setPreference} />
      {!!storageError && <Text accessibilityRole="alert" style={s.error}>{storageError}</Text>}
    </View>
    <View style={s.panel}>
      <Text style={s.section}>Change password</Text>
      <Field label="Current password" value={current} onChangeText={value => { setSaved(false); setCurrent(value); }} secureTextEntry />
      <Field label="New password (12+ characters)" value={replacement} onChangeText={setReplacement} secureTextEntry />
      {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
      {saved && <Text style={s.text}>Password changed. Your other sessions have ended.</Text>}
      <Button title={mutation.busy ? 'Changing…' : 'Change password'} disabled={mutation.busy || !current || replacement.length < 12}
        onPress={() => confirm('Change password?', 'Other devices will be signed out.', () => void mutation.run(async () => {
          setSaved(false);
          await send('PATCH', '/auth/password', { current, replacement });
          setCurrent(''); setReplacement(''); setSaved(true);
        }))} />
    </View>
    <Status {...organization} retry={organization.reload} />
    {user.admin && organization.data && <OrganizationForm organization={organization.data} reload={organization.reload} />}
  </Screen>;
}
