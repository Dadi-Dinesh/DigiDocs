import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { date, send, type AccessRequest, type Dashboard, type Notice, type Organization } from './api';
import { eventLabel } from './admin';
import { permitted, useNav, useUser } from './navigation';
import { Button, c, confirm, DocumentCard, Field, Icon, s, Screen, Status, type IconName, useLoad, useMutation } from './ui';

export function HomeScreen({ openUpload }: { openUpload: () => void }) {
  const user = useUser();
  const nav = useNav();
  const feed = useLoad<Dashboard>('/dashboard');
  const org = useLoad<Organization>('/organization');
  const stats: { label: string; key: keyof Pick<Dashboard, 'total' | 'mine' | 'shared' | 'confidential' | 'pending'>; icon: IconName; onPress: () => void }[] = [
    { label: 'Total documents', key: 'total', icon: 'documents-outline', onPress: () => nav.navigate('List', { mode: 'all' }) },
    { label: 'My uploads', key: 'mine', icon: 'cloud-upload-outline', onPress: () => nav.navigate('List', { mode: 'mine' }) },
    { label: 'Shared with me', key: 'shared', icon: 'people-outline', onPress: () => nav.navigate('List', { mode: 'shared' }) },
    { label: 'Confidential or restricted', key: 'confidential', icon: 'lock-closed-outline', onPress: () => nav.navigate('List', { mode: 'all', sensitive: true }) },
    { label: 'Pending requests', key: 'pending', icon: 'time-outline', onPress: () => nav.navigate('Requests') },
  ];
  return <Screen refresh={() => { feed.reload(); org.reload(); }}>
    <View style={[s.panel, { padding: 21, backgroundColor: '#1C254A', borderColor: '#343E72', gap: 6 }]}>
      <Icon name="shield-checkmark-outline" color="#AAB5FF" size={33} />
      <Text style={s.title}>Welcome, {user.fullName.split(' ')[0]}</Text>
      <Text style={s.muted}>{org.data?.name ?? 'Your organization’s vault'}</Text>
    </View>
    <Status {...feed} retry={feed.reload} />
    {feed.data && <View style={s.wrap}>{stats.map(item => <Pressable key={item.key} accessibilityRole="button" onPress={item.onPress} style={[s.panel, { flexGrow: 1, flexBasis: '44%', gap: 5 }]}>
      <Icon name={item.icon} color="#A5B4FC" size={18} />
      <Text style={[s.title, { fontSize: 25 }]}>{feed.data?.[item.key]}</Text><Text style={s.muted}>{item.label}</Text>
    </Pressable>)}</View>}
    <Text style={s.section}>Quick actions</Text>
    {permitted(user, 'upload') && <Button title="Upload document" icon="cloud-upload-outline" onPress={openUpload} />}
    <Button secondary title="My documents" icon="folder-outline" onPress={() => nav.navigate('List', { mode: 'mine' })} />
    <Button secondary title="Shared with me" icon="people-outline" onPress={() => nav.navigate('List', { mode: 'shared' })} />
    {permitted(user, 'manageAccess') && <Button secondary title="Manage access" icon="key-outline" onPress={() => nav.navigate('List', { mode: 'manage' })} />}
    {feed.data && <>
      <Text style={s.section}>Recent documents</Text>
      <Status empty={feed.data.recent.length ? undefined : 'Documents you can view will appear here.'} />
      {feed.data.recent.map(doc => <DocumentCard key={doc.id} doc={doc} open={() => nav.navigate('Details', { id: doc.id })} />)}
      <Text style={s.section}>Recent activity</Text>
      <Status empty={feed.data.activity.length ? undefined : 'Your document activity will appear here.'} />
      {feed.data.activity.map(item => <View key={item.sequence} style={[s.panel, s.row]}>
        <Icon name="pulse-outline" /><Text style={[s.text, s.fill]}>{eventLabel(item.action)}</Text><Text style={s.muted}>{date(item.timestamp)}</Text>
      </View>)}
    </>}
  </Screen>;
}

export function ActivityScreen() {
  const user = useUser();
  const nav = useNav();
  const feed = useLoad<Notice[]>('/notifications');
  const mutation = useMutation();
  return <Screen title="Activity" subtitle="Notifications and access requests" refresh={feed.reload}>
    <Button secondary title="Access requests" icon="key-outline" onPress={() => nav.navigate('Requests')} />
    {permitted(user, 'audit') && <Button secondary title="Audit logs" icon="list-outline" onPress={() => nav.navigate('Audit')} />}
    <Text style={s.section}>Notifications</Text>
    <Status {...feed} retry={feed.reload} empty={feed.data?.length === 0 ? 'You’re all caught up.' : undefined} />
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    {feed.data?.some(item => !item.read) && <Button secondary title="Mark all as read" disabled={mutation.busy} onPress={() => void mutation.run(async () => {
      await send('PATCH', '/notifications/read');
      feed.reload();
    })} />}
    {feed.data?.map(item => <View key={item.id} style={[s.panel, s.row]}>
      <Icon name={item.read ? 'notifications-outline' : 'notifications'} color={item.read ? c.muted : '#A5B4FC'} />
      <View style={s.fill}><Text style={s.text}>{item.message}</Text><Text style={s.muted}>{date(item.createdAt)}{item.read ? '' : ' · Unread'}</Text></View>
    </View>)}
  </Screen>;
}

export function RequestsScreen() {
  const user = useUser();
  const [documentId, setDocumentId] = useState('');
  const feed = useLoad<AccessRequest[]>('/access-requests');
  const mutation = useMutation();
  function resolve(request: AccessRequest, status: 'approved' | 'declined') {
    const approve = status === 'approved';
    confirm(approve ? 'Approve request?' : 'Decline request?', approve ? 'This grants individual view access.' : 'This closes the request.',
      () => void mutation.run(async () => { await send('PATCH', '/access-requests/' + request.id, { status }); feed.reload(); }));
  }
  return <Screen title="Access requests" refresh={feed.reload}>
    {permitted(user, 'view') && <View style={s.panel}>
      <Text style={s.section}>Request document access</Text>
      <Field label="Document ID" placeholder="Enter the ID from a document manager" autoCapitalize="none" value={documentId} onChangeText={setDocumentId} />
      <Button title="Submit request" disabled={mutation.busy || !documentId.trim()} onPress={() => void mutation.run(async () => {
        await send('POST', '/access-requests', { documentId: documentId.trim() });
        setDocumentId(''); feed.reload();
      })} />
    </View>}
    {!!mutation.error && <Text style={s.error}>{mutation.error}</Text>}
    <Status {...feed} retry={feed.reload} empty={feed.data?.length === 0 ? 'No access requests yet.' : undefined} />
    {feed.data?.map(request => <View key={request.id} style={s.panel}>
      <Text style={s.badge}>{request.status}</Text><Text style={s.section}>{request.title ?? 'Document access'}</Text>
      <Text selectable style={s.mono}>{request.documentId}</Text>
      {request.canResolve && request.status === 'pending' && <>
        <Text style={s.muted}>{request.requester?.fullName} · {request.requester?.employeeId}</Text>
        <Button title="Approve view access" disabled={mutation.busy} onPress={() => resolve(request, 'approved')} />
        <Button secondary danger title="Decline" disabled={mutation.busy} onPress={() => resolve(request, 'declined')} />
      </>}
    </View>)}
  </Screen>;
}
