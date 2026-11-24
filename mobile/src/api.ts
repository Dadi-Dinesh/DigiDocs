import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { DocumentPickerAsset } from 'expo-document-picker';

const fallback = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
export const apiOrigin = (process.env.EXPO_PUBLIC_API_URL || fallback).replace(/\/$/, '');
const api = axios.create({ baseURL: apiOrigin + '/api', timeout: 25000 });
const key = 'docuvault.session';
let token: string | null = null;
let expiryHandler: (() => void) | undefined;

export const sessionToken = () => token;
export async function restoreToken() {
  token = await SecureStore.getItemAsync(key);
  return token;
}
export async function setToken(value: string | null) {
  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
  token = value;
}
export function onSessionExpired(handler?: () => void) {
  expiryHandler = handler;
}
api.interceptors.request.use(config => {
  if (token) config.headers.Authorization = 'Bearer ' + token;
  return config;
});
api.interceptors.response.use(response => response, error => {
  if (error.response?.status === 401 && error.config?.headers?.Authorization === 'Bearer ' + token && token) {
    token = null;
    void SecureStore.deleteItemAsync(key).catch(() => {});
    expiryHandler?.();
  }
  return Promise.reject(error);
});
export const get = async <T,>(path: string) => (await api.get<T>(path)).data;
export const send = async <T = unknown,>(method: string, path: string, data?: object) => (
  await api.request<T>({ method, url: path, data, headers: data instanceof FormData ? { 'Content-Type': 'multipart/form-data' } : undefined })
).data;
export const errorMessage = (error: unknown) =>
  axios.isAxiosError(error) ? error.response?.data?.error ?? 'Could not reach DocuVault. Check your connection and API URL.' :
  error instanceof Error ? error.message : 'Something went wrong.';

export function multipart(file: DocumentPickerAsset, fields: Record<string, string> = {}) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  data.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);
  return data;
}

export const actions = ['view', 'download', 'edit', 'delete', 'manageAccess'] as const;
export type Action = typeof actions[number];
export const permissions = [...actions, 'upload', 'manageEmployees', 'audit'] as const;
export const classifications = ['Public', 'Internal', 'Confidential', 'Restricted'] as const;
export const actionLabel: Record<typeof permissions[number], string> = {
  view: 'View', download: 'Download', edit: 'Edit', delete: 'Delete',
  manageAccess: 'Manage Access', upload: 'Upload', manageEmployees: 'Manage Employees', audit: 'View Audit Logs',
};
export type User = Employee & { permissions: string[]; roleName: string | null; departmentName: string | null };
export type Organization = { id: string; name: string; slug: string; description: string };
export type Named = { id: string; name: string };
export type Role = Named & { permissions: string[] };
export type Employee = {
  id: string; organizationId: string; employeeId: string; fullName: string; email: string;
  designation: string; roleId: string | null; departmentId: string | null; active: boolean; admin: boolean; joiningDate: string;
};
export type Version = {
  number: number; fileName: string; size: number; mime: string; sha256: string; createdAt: string; uploader?: string;
};
export type Document = {
  id: string; title: string; description: string; folder: string; classification: typeof classifications[number];
  departmentId: string | null; createdAt: string; ownerId: string; version: Version; allowed: Action[];
};
export type Grant = { kind: 'role' | 'employee' | 'department'; targetId: string; action: Action; effect: 'allow' | 'deny' };
export type Audit = { sequence: number; action: string; employeeId: string; timestamp: string; documentId: string | null; details: string; previousHash: string; hash: string };
export type Notice = { id: string; message: string; read: boolean; createdAt: string };
export type AccessRequest = {
  id: string; documentId: string; status: string; canResolve: boolean; title?: string;
  requester?: Pick<Employee, 'fullName' | 'employeeId'>;
};
export type Dashboard = {
  total: number;
  organizationTotal: number | null;
  accessible: number;
  uploadedByMe: number;
  mine: number;
  shared: number;
  confidential: number;
  pending: number;
  recent: Document[];
  activity: Audit[];
};
export const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
