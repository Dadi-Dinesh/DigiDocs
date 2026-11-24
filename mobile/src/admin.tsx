import { useState } from 'react';
import { Text, View } from 'react-native';
import { actionLabel, date, permissions, send, type Audit, type Employee, type Named, type Role } from './api';
import { useUser } from './navigation';
import { Button, Chip, Choices, Field, Screen, Status, useLoad, useMutation, useUI, useDialog } from './ui';

type CatalogItem = Named & { permissions?: string[] };
function Catalog({ roles }: { roles: boolean }) {
  const { s } = useUI();
  const { confirm } = useDialog();
  const user = useUser();
  const path = roles ? '/roles' : '/departments';
  const noun = roles ? 'role' : 'department';
  const feed = useLoad<CatalogItem[]>(path);
  const [item, setItem] = useState<CatalogItem>();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const mutation = useMutation();
  function edit(next?: CatalogItem) {
    setItem(next);
    setName(next?.name ?? '');
    setSelected(next?.permissions ?? []);
  }
  return <Screen title={roles ? 'Roles' : 'Departments'} subtitle={roles ? 'Configure permissions for organization roles.' : 'Organize employees and document recipients.'} refresh={feed.reload} refreshing={feed.refreshing}>
    <Status {...feed} retry={feed.reload} empty={feed.data?.length === 0 ? 'No ' + noun + 's yet.' : undefined} />
    {feed.data?.map(row => <View key={row.id} style={s.panel}>
      <Text style={s.section}>{row.name}</Text>
      {roles && <Text style={s.muted}>{row.permissions?.map(permission => actionLabel[permission as keyof typeof actionLabel]).join(' · ') || 'No permissions'}</Text>}
      {user.admin && <Button secondary title={'Edit ' + noun} onPress={() => edit(row)} />}
    </View>)}
    {user.admin && <View style={s.panel}>
      <Text style={s.section}>{(item ? 'Edit ' : 'Create ') + noun}</Text>
      <Field label="Name" value={name} onChangeText={setName} />
      {roles && <View style={s.wrap}>{permissions.map(permission => <Chip key={permission} label={actionLabel[permission]} selected={selected.includes(permission)}
        onPress={() => setSelected(previous => previous.includes(permission) ? previous.filter(value => value !== permission) : [...previous, permission])} />)}</View>}
      {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
      <Button title={mutation.busy ? 'Saving…' : item ? 'Save changes' : 'Create ' + noun} disabled={mutation.busy || !name.trim()} onPress={() => {
        const save = () => void mutation.run(async () => {
          await send(item ? 'PATCH' : 'POST', item ? path + '/' + item.id : path, roles ? { name, permissions: selected } : { name });
          edit();
          feed.reload();
        });
        if (roles && item) confirm('Update this role?', 'Changes apply to every employee assigned to this role.', save);
        else save();
      }} />
      {item && <Button secondary title="Cancel editing" onPress={() => edit()} />}
    </View>}
  </Screen>;
}
export const RolesScreen = () => <Catalog roles />;
export const DepartmentsScreen = () => <Catalog roles={false} />;

function EmployeeForm({ employee, close, roles, departments }: { employee?: Employee; close: () => void; roles: Role[]; departments: Named[] }) {
  const { s } = useUI();
  const user = useUser();
  const [fullName, setName] = useState(employee?.fullName ?? '');
  const [employeeId, setEmployeeId] = useState(employee?.employeeId ?? '');
  const [email, setEmail] = useState(employee?.email ?? '');
  const [designation, setDesignation] = useState(employee?.designation ?? '');
  const [roleId, setRole] = useState(employee?.roleId ?? '');
  const [departmentId, setDepartment] = useState(employee?.departmentId ?? '');
  const [joiningDate, setJoining] = useState(employee?.joiningDate.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [password, setPassword] = useState('');
  const mutation = useMutation();
  return <View style={s.panel}>
    <Text style={s.section}>{employee ? 'Edit employee' : 'Register employee'}</Text>
    <Field label="Full name" value={fullName} onChangeText={setName} />
    <Field label="Employee ID" value={employeeId} onChangeText={setEmployeeId} autoCapitalize="characters" />
    <Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
    <Field label="Designation" value={designation} onChangeText={setDesignation} />
    <Field label="Joining date" placeholder="YYYY-MM-DD" value={joiningDate} onChangeText={setJoining} />
    {user.admin && <Choices label="Role" options={[{ id: '', name: 'Unassigned' }, ...roles]} value={roleId} select={setRole} />}
    {(user.admin || !employee) && <Choices label="Department" options={[{ id: '', name: 'Unassigned' }, ...departments]} value={departmentId} select={setDepartment} />}
    {!employee && <Field label="Initial password (12+ characters)" secureTextEntry value={password} onChangeText={setPassword} />}
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    <Button title={mutation.busy ? 'Saving…' : employee ? 'Save employee' : 'Register employee'} disabled={mutation.busy || !fullName.trim() || !employeeId.trim() || !email.trim() || !designation.trim() || (!employee && password.length < 12)}
      onPress={() => void mutation.run(async () => {
        await send(employee ? 'PATCH' : 'POST', employee ? '/employees/' + employee.id : '/employees', {
          fullName, employeeId, email, designation, joiningDate, roleId: roleId || null, departmentId: departmentId || null,
          ...(!employee && { password }),
        });
        close();
      })} />
    <Button secondary title="Cancel" onPress={close} />
  </View>;
}
export function EmployeesScreen() {
  const { s } = useUI();
  const { confirm } = useDialog();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Employee | 'new'>();
  const feed = useLoad<Employee[]>('/employees?q=' + encodeURIComponent(query));
  const departments = useLoad<Named[]>('/departments');
  const roles = useLoad<Role[]>('/roles');
  const mutation = useMutation();
  return <Screen title="Employees" subtitle="Manage organization members" refresh={feed.reload} refreshing={feed.refreshing}>
    <Field label="Search employees" value={query} onChangeText={setQuery} placeholder="Name, Employee ID, department or designation" />
    {!editing && <Button title="Register employee" icon="person-add-outline" onPress={() => setEditing('new')} />}
    <Status {...feed} retry={feed.reload} empty={feed.data?.length === 0 ? 'No matching employees.' : undefined} />
    <Status {...departments} retry={departments.reload} />
    <Status {...roles} retry={roles.reload} />
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    {editing && <EmployeeForm key={editing === 'new' ? 'new' : editing.id} employee={editing === 'new' ? undefined : editing}
      roles={roles.data ?? []} departments={departments.data ?? []} close={() => { setEditing(undefined); feed.reload(); }} />}
    {feed.data?.map(employee => <View key={employee.id} style={s.panel}>
      <View style={s.row}><Text style={[s.section, s.fill]}>{employee.fullName}</Text><Text style={s.badge}>{employee.active ? 'Active' : 'Inactive'}</Text></View>
      <Text style={s.muted}>{employee.employeeId} · {employee.designation}</Text>
      <Text style={s.text}>{employee.email}</Text>
      <Text style={s.muted}>{departments.data?.find(item => item.id === employee.departmentId)?.name ?? 'Unassigned department'} · {employee.admin ? 'Administrator' : roles.data?.find(item => item.id === employee.roleId)?.name ?? 'Unassigned role'}</Text>
      <Text style={s.muted}>Joined {date(employee.joiningDate)}</Text>
      {!employee.admin && <>
        <Button secondary title="Edit employee" onPress={() => setEditing(employee)} />
        <Button secondary danger={employee.active} title={employee.active ? 'Deactivate' : 'Activate'} disabled={mutation.busy} onPress={() => confirm(
          employee.active ? 'Deactivate account?' : 'Activate account?',
          employee.active ? 'This immediately revokes the employee’s sessions.' : 'This allows the employee to sign in again.',
          () => void mutation.run(async () => {
            await send('PATCH', '/employees/' + employee.id, { active: !employee.active });
            feed.reload();
          }), employee.active,
        )} />
      </>}
    </View>)}
  </Screen>;
}

export const eventLabel = (value: string) => value.toLowerCase().replace(/_/g, ' ').replace(/^./, first => first.toUpperCase());
export function AuditScreen() {
  const { c, s } = useUI();
  const feed = useLoad<Audit[]>('/audit');
  const [result, setResult] = useState<{ valid: boolean; entries?: number; sequence?: number }>();
  const mutation = useMutation();
  return <Screen title="Audit logs" subtitle="Latest 100 organization events" refresh={feed.reload} refreshing={feed.refreshing}>
    <Button title={mutation.busy ? 'Verifying…' : 'Verify audit chain'} icon="shield-checkmark-outline" disabled={mutation.busy} onPress={() => void mutation.run(async () =>
      setResult(await send('GET', '/audit/verify'))
    )} />
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    {result && <Text style={[s.text, { color: result.valid ? c.text : c.red }]}>{result.valid ? 'Verified ' + result.entries + ' audit entries.' : 'Chain mismatch at sequence ' + result.sequence + '.'}</Text>}
    <Status {...feed} retry={feed.reload} empty={feed.data?.length === 0 ? 'No audit events yet.' : undefined} />
    {feed.data?.map(item => <View key={item.sequence} style={s.panel}>
      <Text style={s.section}>{eventLabel(item.action)}</Text><Text style={s.muted}>{item.employeeId} · {new Date(item.timestamp).toLocaleString()}</Text>
      {item.documentId && <Text selectable style={s.mono}>{item.documentId}</Text>}
      <Text style={s.label}>Sequence {item.sequence} · Entry hash</Text><Text selectable style={s.mono}>{item.hash}</Text>
      {item.previousHash && <><Text style={s.label}>Previous hash</Text><Text selectable style={s.mono}>{item.previousHash}</Text></>}
      {item.details !== '{}' && <Text selectable style={s.muted}>{item.details}</Text>}
    </View>)}
  </Screen>;
}
