import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { date, send, type Organization, type User } from './api';
import { permitted, useNav, useSession, useUser, type Routes } from './navigation';
import { Button, c, confirm, Field, Icon, s, Screen, Status, useLoad, useMutation } from './ui';

type Credentials = Routes['Setup'];
function Brand() {
  return <View style={{ gap: 12, marginTop: 16 }}>
    <View style={{ backgroundColor: '#2B3774', borderWidth: 1, borderColor: '#515EB0', width: 62, height: 62, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="shield-checkmark-outline" color="#DFE5FF" size={32} />
    </View>
    <Text style={s.title}>DocuVault</Text>
    <Text style={s.muted}>Your organization’s secure document vault</Text>
  </View>;
}
export function LoginScreen() {
  const [slug, setSlug] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const mutation = useMutation();
  const nav = useNav();
  const { signIn } = useSession();
  return <Screen><Brand /><View style={s.panel}>
    <Text style={s.section}>Sign in</Text>
    <Field label="Organization code" autoCapitalize="none" autoCorrect={false} value={slug} onChangeText={setSlug} />
    <Field label="Employee ID" autoCapitalize="characters" autoCorrect={false} value={employeeId} onChangeText={setEmployeeId} />
    <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} />
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    <Button title={mutation.busy ? 'Signing in…' : 'Sign in'} icon="arrow-forward" disabled={mutation.busy || !slug.trim() || !employeeId.trim() || !password} onPress={() => void mutation.run(async () => {
      const result = await send<{ token: string }>('POST', '/auth/login', { slug, employeeId, password });
      await signIn(result.token);
    })} />
  </View><Button secondary title="Register an organization" onPress={() => nav.navigate('Registration')} /></Screen>;
}
export function RegisterScreen() {
  const [fullName, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const nav = useNav();
  const details: Credentials = { fullName, employeeId, email, password };
  return <Screen title="Create your account" subtitle="Register as the administrator for a new organization.">
    <Field label="Full name" value={fullName} onChangeText={setName} />
    <Field label="Employee ID" value={employeeId} onChangeText={setEmployeeId} autoCapitalize="characters" />
    <Field label="Work email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
    <Field label="Password (12+ characters)" value={password} onChangeText={setPassword} secureTextEntry />
    <Button title="Continue to organization setup" disabled={!fullName.trim() || !employeeId.trim() || !email.trim() || password.length < 12} onPress={() => nav.navigate('Setup', details)} />
  </Screen>;
}
export function SetupScreen({ route }: NativeStackScreenProps<Routes, 'Setup'>) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const mutation = useMutation();
  const { signIn } = useSession();
  return <Screen title="Organization setup" subtitle="Employees will use your organization code when they sign in.">
    <Field label="Organization name" value={name} onChangeText={setName} />
    <Field label="Organization code" value={slug} onChangeText={setSlug} placeholder="acme-finance" autoCapitalize="none" autoCorrect={false} />
    <Field label="Description" value={description} onChangeText={setDescription} multiline />
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    <Button title={mutation.busy ? 'Creating…' : 'Create organization'} disabled={mutation.busy || !name.trim() || !slug.trim()} onPress={() => void mutation.run(async () => {
      const result = await send<{ token: string }>('POST', '/auth/register', { ...route.params, name, slug, description });
      await signIn(result.token);
    })} />
  </Screen>;
}
export function ProfileScreen() {
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
  return <Screen title="Profile" refresh={() => { profile.reload(); org.reload(); }}>
    <View style={s.panel}>
      <View style={s.row}>
        <Icon name="person-circle-outline" color="#A5B4FC" size={42} />
        <View style={s.fill}>
          <Text style={s.section}>{user.fullName}</Text>
          <Text style={s.muted}>{user.designation}</Text>
        </View>
      </View>
      {details.map(({ label, value }) => <View key={label}>
        <Text style={s.label}>{label}</Text>
        <Text selectable style={s.text}>{value}</Text>
      </View>)}
      <View>
        <Text style={s.label}>Account status</Text>
        <Text style={[s.badge, { color: user.active ? '#86EFAC' : c.red }]}>{user.active ? 'Active' : 'Inactive'}</Text>
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
  const [name, setName] = useState(organization.name);
  const [description, setDescription] = useState(organization.description);
  const [saved, setSaved] = useState(false);
  const mutation = useMutation();
  return <View style={s.panel}>
    <Text style={s.section}>Organization details</Text>
    <Field label="Organization name" value={name} onChangeText={value => { setSaved(false); setName(value); }} />
    <Field label="Description" value={description} onChangeText={value => { setSaved(false); setDescription(value); }} multiline />
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    {saved && <Text style={{ color: c.green }}>Organization details saved.</Text>}
    <Button secondary title={mutation.busy ? 'Saving…' : 'Save organization'} disabled={mutation.busy || !name.trim()} onPress={() => void mutation.run(async () => {
      await send('PATCH', '/organization', { name, description });
      setSaved(true);
      reload();
    })} />
  </View>;
}
export function SettingsScreen() {
  const user = useUser();
  const organization = useLoad<Organization>(user.admin ? '/organization' : null);
  const [current, setCurrent] = useState('');
  const [replacement, setReplacement] = useState('');
  const [saved, setSaved] = useState(false);
  const mutation = useMutation();
  return <Screen title="Settings">
    <View style={s.panel}>
      <Text style={s.section}>Change password</Text>
      <Field label="Current password" value={current} onChangeText={value => { setSaved(false); setCurrent(value); }} secureTextEntry />
      <Field label="New password (12+ characters)" value={replacement} onChangeText={setReplacement} secureTextEntry />
      {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
      {saved && <Text style={{ color: c.green }}>Password changed. Your other sessions have ended.</Text>}
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
