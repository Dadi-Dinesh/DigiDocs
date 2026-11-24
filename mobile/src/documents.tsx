import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, Text, View } from 'react-native';
import * as Picker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { actions, actionLabel, apiOrigin, classifications, date, get, multipart, send, sessionToken, type Document, type Employee, type Grant, type Named, type Version } from './api';
import { permitted, useNav, useUser, type Routes } from './navigation';
import { Button, c, Chip, Choices, confirm, DocumentCard, Field, Icon, s, Screen, Status, useLoad, useMutation } from './ui';

const size = (bytes: number) => bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.ceil(bytes / 1024) + ' KB';
const kinds = [{ id: 'role', name: 'Roles' }, { id: 'department', name: 'Departments' }, { id: 'employee', name: 'Employees' }] as const;
const modes = [{ id: 'all', name: 'All' }, { id: 'mine', name: 'My documents' }, { id: 'shared', name: 'Shared with me' }] as const;
const mimeTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png'];

async function pickFile() {
  const picked = await Picker.getDocumentAsync({ type: mimeTypes, copyToCacheDirectory: true });
  const file = picked.assets?.[0];
  if (file?.size && file.size > 20 * 1024 * 1024) {
    discardPickerFile(file);
    throw new Error('Choose a file up to 20 MB.');
  }
  return file;
}

function discardPickerFile(file: Picker.DocumentPickerAsset) {
  try {
    const local = new File(file.uri);
    if (local.exists) local.delete();
  } catch { /* OS-managed cache */ }
}

async function download(id: string, version: Version) {
  if (!await Sharing.isAvailableAsync()) throw new Error('File export is unavailable on this device.');
  const token = sessionToken();
  if (!token) throw new Error('Sign in to download this file.');
  const local = new File(Paths.cache, Date.now() + '-' + version.fileName.replace(/[^a-zA-Z0-9._-]/g, '_'));
  try {
    const file = await File.downloadFileAsync(apiOrigin + '/api/documents/' + id + '/versions/' + version.number + '/download', local, {
      headers: { Authorization: 'Bearer ' + token },
    });
    await Sharing.shareAsync(file.uri, { mimeType: version.mime, dialogTitle: 'Save or open document' });
  } finally {
    if (local.exists) local.delete();
  }
}
export function DocumentList({ mode: initial = 'all', sensitive = false }: Partial<Routes['List']>) {
  const [mode, setMode] = useState(initial);
  const [query, setQuery] = useState('');
  const [classification, setClassification] = useState<string>(sensitive ? 'sensitive' : '');
  const nav = useNav();
  const term = query.trim();
  const feed = useLoad<Document[]>('/documents?mode=' + mode + '&q=' + encodeURIComponent(term) + '&classification=' + classification);
  const title = { all: 'All documents', mine: 'My documents', shared: 'Shared with me', manage: 'Manage access' }[mode];
  return <Screen title={title} subtitle="Browse your organization’s vault" refresh={feed.reload}>
    <Field label="Search documents" placeholder="Title, file name, or description" value={query}
      onChangeText={setQuery} maxLength={160} returnKeyType="search" autoCorrect={false} />
    {!!query && <View style={{ alignSelf: 'flex-start' }}>
      <Button title="Clear search" icon="close-outline" secondary onPress={() => setQuery('')} />
    </View>}
    {initial !== 'manage' && <Choices label="Document scope" options={modes} value={mode} select={setMode} />}
    <Choices label="Classification filter" options={[{ id: '', name: 'Any' }, { id: 'sensitive', name: 'Confidential or restricted' }, ...classifications.map(id => ({ id, name: id }))]} value={classification} select={setClassification} />
    <Status {...feed} retry={feed.reload} />
    {feed.data?.length === 0 && <View style={s.panel}>
      <Icon name={term ? 'search-outline' : 'folder-open-outline'} color="#A5B4FC" />
      <Text style={s.section}>{term ? 'No matching documents' : 'No documents to show'}</Text>
      <Text style={s.muted}>{term ? 'Try a different title, file name, or description. You can also clear your search or adjust the filters.' :
        'Documents you have access to will appear here. Try a different filter to see more.'}</Text>
    </View>}
    {feed.data?.map(doc => <DocumentCard key={doc.id} doc={doc} open={() => nav.navigate(mode === 'manage' ? 'Access' : 'Details', { id: doc.id })} />)}
  </Screen>;
}
export const ListScreen = ({ route }: NativeStackScreenProps<Routes, 'List'>) => <DocumentList key={route.params.mode + String(route.params.sensitive)} {...route.params} />;

function MetadataForm({ doc, save }: { doc?: Document; save: (data: { title: string; description: string; folder: string; classification: Document['classification']; departmentId: string }, file?: Picker.DocumentPickerAsset) => Promise<void>; }) {
  const [title, setTitle] = useState(doc?.title ?? '');
  const [description, setDescription] = useState(doc?.description ?? '');
  const [folder, setFolder] = useState(doc?.folder ?? 'General');
  const [classification, setClassification] = useState<Document['classification']>(doc?.classification ?? 'Internal');
  const [departmentId, setDepartment] = useState(doc?.departmentId ?? '');
  const [file, setFile] = useState<Picker.DocumentPickerAsset>();
  const cachedFile = useRef(file);
  useEffect(() => () => {
    if (cachedFile.current) discardPickerFile(cachedFile.current);
  }, []);
  const updateFile = (picked?: Picker.DocumentPickerAsset) => {
    if (cachedFile.current) discardPickerFile(cachedFile.current);
    cachedFile.current = picked;
    setFile(picked);
  };
  const dept = useLoad<Named[]>('/departments');
  const folders = useLoad<string[]>('/folders');
  const mutation = useMutation();
  return <Screen title={doc ? 'Edit document' : 'Upload document'} subtitle={doc ? 'Update the document’s catalog details.' : 'Add a file to your organization’s vault.'}>
    {!doc && <View style={s.panel}>
      <Icon name="cloud-upload-outline" color="#A5B4FC" size={30} />
      <Text style={s.section}>{file?.name ?? 'Choose a file'}</Text>
      <Text style={s.muted}>{file ? size(file.size ?? 0) : 'PDF, DOCX, XLSX, JPG or PNG · Up to 20 MB'}</Text>
      <Button secondary title={file ? 'Replace file' : 'Browse files'} disabled={mutation.busy} onPress={() => void mutation.run(async () => {
        const picked = await pickFile();
        if (picked) updateFile(picked);
      })} />
    </View>}
    <Field label="Document title" value={title} onChangeText={setTitle} />
    <Field label="Description" value={description} onChangeText={setDescription} multiline />
    {!!folders.data?.length && <Choices label="Existing folders" options={folders.data.map(id => ({ id, name: id }))} value={folder} select={setFolder} />}
    <Field label="Workspace or folder" value={folder} onChangeText={setFolder} />
    <Status {...dept} retry={dept.reload} />
    <Choices label="Department" options={[{ id: '', name: 'Unassigned' }, ...(dept.data ?? [])]} value={departmentId} select={setDepartment} />
    {(!doc || doc.allowed.includes('manageAccess')) &&
      <Choices label="Classification" options={classifications.map(id => ({ id, name: id }))} value={classification} select={setClassification} />}
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    <Button title={mutation.busy ? 'Saving…' : doc ? 'Save changes' : 'Upload document'} icon="checkmark-circle-outline"
      disabled={mutation.busy || !title.trim() || !folder.trim() || (!doc && !file)}
      onPress={() => void mutation.run(async () => {
        await save({ title, description, folder, classification, departmentId }, file);
        if (!doc) {
          updateFile();
          setTitle('');
          setDescription('');
          setFolder('General');
          setClassification('Internal');
          setDepartment('');
        }
      })} />
  </Screen>;
}

export function UploadScreen() {
  const user = useUser();
  const nav = useNav();
  if (!permitted(user, 'upload')) return <Screen title="Upload"><Status empty="Your role does not have upload permission." /></Screen>;
  return <MetadataForm save={async (fields, file) => {
    if (!file) return;
    const doc = await send<Document>('POST', '/documents', multipart(file, fields));
    if (doc.allowed.includes('manageAccess')) nav.navigate('Access', { id: doc.id });
    else if (doc.allowed.includes('view')) nav.navigate('Details', { id: doc.id });
    else Alert.alert('Upload complete', 'Your file is in the vault. Contact a document manager to set its access rules.');
  }} />;
}
export function EditScreen({ route, navigation }: NativeStackScreenProps<Routes, 'Edit'>) {
  const path = '/documents/' + route.params.id;
  const feed = useLoad<Document>(path);
  if (!feed.data) return <Screen title="Edit document"><Status {...feed} retry={feed.reload} /></Screen>;
  return <MetadataForm doc={feed.data} save={async fields => {
    await send('PATCH', path, { ...fields, departmentId: fields.departmentId || null });
    navigation.goBack();
  }} />;
}
export function DetailsScreen({ route, navigation }: NativeStackScreenProps<Routes, 'Details'>) {
  const { id } = route.params;
  const feed = useLoad<Document>('/documents/' + id);
  const mutation = useMutation();
  const doc = feed.data;
  return <Screen title={doc?.title ?? 'Document details'} subtitle={doc?.folder} refresh={feed.reload}>
    <Status {...feed} retry={feed.reload} />
    {doc && <>
      <View style={s.panel}>
        <Text style={s.badge}>{doc.classification}</Text>
        {!!doc.description && <Text style={s.text}>{doc.description}</Text>}
        <Text style={s.section}>{doc.version.fileName}</Text>
        <Text style={s.muted}>{size(doc.version.size)} · Version {doc.version.number} · {date(doc.version.createdAt)}</Text>
        <Text style={s.muted}>{doc.version.mime}</Text>
      </View>
      <View style={s.panel}><Text style={s.label}>Your permissions</Text><View style={s.wrap}>
        {doc.allowed.map(action => <Text key={action} style={s.badge}>{actionLabel[action]}</Text>)}
      </View></View>
      {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
      <Button title="Preview document" icon="eye-outline" onPress={() => navigation.navigate('Preview', { id, number: doc.version.number, fileName: doc.version.fileName })} />
      {doc.allowed.includes('download') && <Button title={mutation.busy ? 'Working…' : 'Download file'} disabled={mutation.busy} icon="download-outline" onPress={() => void mutation.run(() => download(id, doc.version))} />}
      <Button secondary title="Version history" icon="layers-outline" onPress={() => navigation.navigate('Versions', { id, download: doc.allowed.includes('download'), edit: doc.allowed.includes('edit') })} />
      <Button secondary title="Verify SHA-256" icon="shield-checkmark-outline" onPress={() => navigation.navigate('Verify', { id, number: doc.version.number })} />
      {doc.allowed.includes('edit') && <Button secondary title="Edit details" onPress={() => navigation.navigate('Edit', { id })} />}
      {doc.allowed.includes('manageAccess') && <>
        <Button secondary title="Manage access" icon="people-outline" onPress={() => navigation.navigate('Access', { id })} />
        <View style={s.panel}><Text style={s.label}>Document ID for access requests</Text><Text selectable style={s.mono}>{id}</Text></View>
      </>}
      {doc.allowed.includes('delete') && <Button danger title="Delete document" disabled={mutation.busy} onPress={() =>
        confirm('Delete document?', 'This removes the document from the vault for all employees.', () => void mutation.run(async () => {
          await send('DELETE', '/documents/' + id);
          navigation.goBack();
        }), true)} />}
    </>}
  </Screen>;
}

type AccessData = { title: string; classification: string; grants: Grant[] };
export function AccessScreen({ route }: NativeStackScreenProps<Routes, 'Access'>) {
  const path = '/documents/' + route.params.id + '/grants';
  const feed = useLoad<AccessData>(path);
  return feed.data ? <AccessEditor path={path} record={feed.data} reload={feed.reload} /> :
    <Screen title="Manage access"><Status {...feed} retry={feed.reload} /></Screen>;
}
function AccessEditor({ path, record, reload }: { path: string; record: AccessData; reload: () => void }) {
  const [kind, setKind] = useState<Grant['kind']>('role');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [original, setOriginal] = useState(record.grants);
  const [grants, setGrants] = useState(record.grants);
  const [review, setReview] = useState(false);
  const mutation = useMutation();
  const roles = useLoad<Named[]>('/roles');
  const departments = useLoad<Named[]>('/departments');
  const employees = useLoad<Pick<Employee, 'id' | 'employeeId' | 'fullName'>[]>('/employees' + (query ? '?q=' + encodeURIComponent(query) : ''));
  const employeeOptions = employees.data?.map(item => ({ id: item.id, name: item.employeeId + ' · ' + item.fullName })) ?? [];
  const options = kind === 'role' ? roles.data ?? [] : kind === 'department' ? departments.data ?? [] : employeeOptions;
  const group = kind === 'role' ? roles : kind === 'department' ? departments : employees;
  const nameFor = (grant: Grant) => {
    const candidates = grant.kind === 'role' ? roles.data : grant.kind === 'department' ? departments.data : employeeOptions;
    return candidates?.find(item => item.id === grant.targetId)?.name ?? grant.targetId;
  };
  const selectRule = (action: Grant['action'], effect: '' | Grant['effect']) => {
    const other = grants.filter(grant => !(grant.kind === kind && grant.targetId === target && grant.action === action));
    setGrants(effect ? [...other, { kind, targetId: target, action, effect }] : other);
  };
  return <Screen title={review ? 'Review access' : 'Manage access'} subtitle={record.title + ' · ' + record.classification}>
    {!review && <>
      <View style={s.panel}><Text style={s.muted}>A matching denial overrides an allow. Restricted documents require individual grants. Confidential documents accept role or employee grants.</Text></View>
      <Choices label="Grant to" options={kinds} value={kind} select={value => { setKind(value); setTarget(''); }} />
      {kind === 'employee' && <Field label="Find by Employee ID" value={query} onChangeText={setQuery} autoCapitalize="characters" />}
      <Status {...group} retry={group.reload} empty={options.length === 0 && !group.loading && !group.error ? 'No matching recipients.' : undefined} />
      {!!options.length && <Choices label="Select a recipient" options={options} value={target} select={setTarget} />}
      {!!target && <View style={s.panel}>{actions.map(action => <Choices key={action} label={actionLabel[action]}
        options={[{ id: '', name: 'No rule' }, { id: 'allow', name: 'Allow' }, { id: 'deny', name: 'Deny' }] as const}
        value={grants.find(grant => grant.kind === kind && grant.targetId === target && grant.action === action)?.effect ?? ''}
        select={effect => selectRule(action, effect)} />)}</View>}
    </>}
    <Text style={s.section}>Access summary</Text>
    {!grants.length && <Status empty="No explicit rules. The uploader and administrator retain access where their role allows it." />}
    {grants.map(grant => <View key={[grant.kind, grant.targetId, grant.action].join('/')} style={[s.panel, s.row]}>
      <View style={s.fill}><Text style={s.text}>{nameFor(grant)}</Text><Text style={s.muted}>{grant.kind} · {actionLabel[grant.action]}</Text></View>
      <Text style={[s.badge, grant.effect === 'deny' && { color: c.red }]}>{grant.effect === 'allow' ? 'Allow' : 'Deny'}</Text>
      {!review && <Chip label="Remove" selected={false} onPress={() => setGrants(grants.filter(item => item !== grant))} />}
    </View>)}
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    {review ? <>
      <Button secondary title="Continue editing" disabled={mutation.busy} onPress={() => setReview(false)} />
      <Button title={mutation.busy ? 'Saving…' : 'Save access rules'} disabled={mutation.busy} onPress={() => void mutation.run(async () => {
        await send('PUT', path, { grants, original });
        setOriginal(grants);
        setReview(false);
        Alert.alert('Access updated', 'The new permissions are now active.');
      })} />
    </> : <>
      <Button title="Review changes" onPress={() => setReview(true)} />
      <Button secondary title="Reload saved rules" onPress={() => confirm('Reload rules?', 'Unsaved edits will be discarded.', () => void mutation.run(async () => {
        const latest = await get<AccessData>(path);
        setOriginal(latest.grants);
        setGrants(latest.grants);
        reload();
      }))} />
    </>}
  </Screen>;
}

export function VersionsScreen({ route, navigation }: NativeStackScreenProps<Routes, 'Versions'>) {
  const { id, edit, download: canDownload } = route.params;
  const path = '/documents/' + id + '/versions';
  const feed = useLoad<Version[]>(path);
  const mutation = useMutation();
  return <Screen title="Version history" refresh={feed.reload}>
    <Status {...feed} retry={feed.reload} />
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    {edit && <Button title={mutation.busy ? 'Working…' : 'Upload new version'} icon="cloud-upload-outline" disabled={mutation.busy} onPress={() => void mutation.run(async () => {
      const file = await pickFile();
      if (!file) return;
      try { await send('POST', path, multipart(file)); } finally { discardPickerFile(file); }
      feed.reload();
    })} />}
    {feed.data?.map(version => <View key={version.number} style={s.panel}>
      <Text style={s.badge}>Version {version.number}</Text><Text style={s.section}>{version.fileName}</Text>
      <Text style={s.muted}>{date(version.createdAt)} · {size(version.size)} · {version.uploader ?? 'Uploader unavailable'}</Text>
      <Text selectable style={s.mono}>{version.sha256}</Text>
      <Button secondary title="Preview version" onPress={() => navigation.navigate('Preview', { id, number: version.number, fileName: version.fileName })} />
      <Button secondary title="Verify fingerprint" onPress={() => navigation.navigate('Verify', { id, number: version.number })} />
      {canDownload && <Button secondary title="Download version" disabled={mutation.busy} onPress={() => void mutation.run(() => download(id, version))} />}
    </View>)}
  </Screen>;
}
export function VerifyScreen({ route }: NativeStackScreenProps<Routes, 'Verify'>) {
  const { id, number } = route.params;
  const path = '/documents/' + id + '/versions/' + number + '/verify';
  const [result, setResult] = useState<{ valid: boolean; expected: string; computed: string }>();
  const mutation = useMutation();
  return <Screen title="SHA-256 verification" subtitle={'Document version ' + number}>
    <View style={s.panel}><Icon name="shield-checkmark-outline" color={result?.valid ? c.green : '#A5B4FC'} size={32} />
      <Text style={s.muted}>Compare the stored fingerprint with the current file bytes.</Text></View>
    <Button title={mutation.busy ? 'Checking…' : 'Verify integrity'} disabled={mutation.busy} onPress={() => void mutation.run(async () => {
      setResult(undefined);
      setResult(await get(path));
    })} />
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    {result && <View style={s.panel}>
      <Text style={[s.section, { color: result.valid ? c.green : c.red }]}>{result.valid ? 'Fingerprints match' : 'Fingerprint mismatch'}</Text>
      <Text style={s.label}>Stored fingerprint</Text><Text selectable style={s.mono}>{result.expected}</Text>
      <Text style={s.label}>Computed fingerprint</Text><Text selectable style={s.mono}>{result.computed}</Text>
    </View>}
  </Screen>;
}

type Preview = { page: number; pages: number } & (
  { kind: 'image'; data: string; width: number; height: number } |
  { kind: 'text'; lines: string[]; truncated: boolean }
);
export function PreviewScreen({ route }: NativeStackScreenProps<Routes, 'Preview'>) {
  const { id, number, fileName } = route.params;
  const [page, setPage] = useState(1);
  const feed = useLoad<Preview>('/documents/' + id + '/versions/' + number + '/preview/' + page);
  const preview = feed.data;
  return <Screen title="Document preview" subtitle={fileName + ' · Version ' + number}>
    <Status {...feed} retry={feed.reload} />
    {preview && <>
      {preview.kind === 'image' ? <Image accessibilityLabel={'Preview page ' + page}
        source={{ uri: 'data:image/png;base64,' + preview.data }}
        style={{ width: '100%', aspectRatio: preview.width / preview.height, backgroundColor: c.card }} resizeMode="contain" /> :
        <View style={s.panel}>
          <Text style={s.label}>Text preview</Text>
          {preview.lines.length ? preview.lines.map((line, index) => <Text selectable key={index} style={s.text}>{line || ' '}</Text>) :
            <Text style={s.muted}>No text is available on this page.</Text>}
          {preview.truncated && <Text style={s.muted}>Long lines have been shortened.</Text>}
        </View>}
      <Text style={s.muted}>Page {page} of {preview.pages}</Text>
      {preview.pages > 1 && <View style={s.row}>
        <View style={s.fill}><Button secondary title="Previous" disabled={page <= 1} onPress={() => setPage(page - 1)} /></View>
        <View style={s.fill}><Button secondary title="Next" disabled={page >= preview.pages} onPress={() => setPage(page + 1)} /></View>
      </View>}
    </>}
    {!preview && page > 1 && <Button secondary title="Previous page" onPress={() => setPage(page - 1)} />}
  </Screen>;
}
