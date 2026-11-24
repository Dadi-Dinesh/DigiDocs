import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { audit } from './database.js';
import { endpoint, fail, id, label, requirePermission, sameOrg, scopes } from './http.js';
import { actions, can, classifications, documentAccess } from './policy.js';
import { renderPreview } from './preview.js';
import { MAX_BYTES, sha256, storage } from './storage.js';

export const documents = Router();
const parseUpload = multer({ limits: { fileSize: MAX_BYTES, files: 1, fields: 8, parts: 10, fieldSize: 16 * 1024 } }).single('file');
let uploads = 0;
function upload(req, res, next) {
  if (uploads >= 4) throw fail(503, 'Upload capacity is busy. Try again shortly.');
  uploads++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    uploads--;
  };
  res.once('finish', release);
  res.once('close', release);
  parseUpload(req, res, next);
}
const metadata = z.object({
  title: label, description: z.string().max(4000), folder: label,
  classification: z.enum(classifications),
  departmentId: z.preprocess(value => value === '' ? null : value, id.nullable()),
});
const uploadMetadata = metadata.extend({
  description: metadata.shape.description.default(''), folder: label.default('General'),
  departmentId: metadata.shape.departmentId.default(null),
});
const publicVersion = { storageKey: true };
const documentInclude = { grants: true, versions: { orderBy: { number: 'desc' }, take: 1, omit: publicVersion } };
const viewModel = (user, document) => {
  const { grants, versions, ...fields } = document;
  return { ...fields, version: versions[0], allowed: actions.filter(action => documentAccess(user, document, action)) };
};

async function findDoc(tx, req) {
  const document = await tx.document.findFirst({
    where: { ...scopes(req), id: id.parse(req.params.id), deletedAt: null }, include: documentInclude,
  });
  if (!document) throw fail(404, 'Document not found.');
  req.documentForAudit = document.id;
  return document;
}
async function authorized(tx, req, action) {
  const document = await findDoc(tx, req);
  if (!documentAccess(req.user, document, action)) throw fail(403, 'Document access is restricted.');
  return document;
}
async function findVersion(tx, req, document) {
  const number = req.params.number ? z.coerce.number().int().positive().parse(req.params.number) : document.versions[0].number;
  const version = await tx.version.findUnique({ where: { documentId_number: { documentId: document.id, number } } });
  if (!version) throw fail(404, 'Version not found.');
  return version;
}
async function saveVersion(tx, req, documentId, number) {
  const file = await storage.save(req.file);
  req.rollbackFile = () => storage.remove(file.storageKey);
  return tx.version.create({ data: { ...file, documentId, number, uploaderId: req.user.id }, omit: publicVersion });
}
async function visibleDocuments(tx, req) {
  const rows = await tx.document.findMany({
    where: { ...scopes(req), deletedAt: null }, include: documentInclude, orderBy: { createdAt: 'desc' },
  });
  return rows.filter(doc => actions.some(action => documentAccess(req.user, doc, action))).map(doc => viewModel(req.user, doc));
}

documents.get('/dashboard', endpoint(async (tx, req) => {
  const rows = (await visibleDocuments(tx, req)).filter(doc => doc.allowed.includes('view'));
  const mine = rows.filter(doc => doc.ownerId === req.user.id).length;
  const activity = await tx.audit.findMany({
    where: { ...scopes(req), userId: req.user.id }, orderBy: { sequence: 'desc' }, take: 8,
  });
  const pending = (await listRequests(tx, req)).filter(request => request.status === 'pending').length;
  const activeDocuments = { ...scopes(req), deletedAt: null };
  const organizationTotal = req.user.admin ? await tx.document.count({ where: activeDocuments }) : null;
  const uploadedByMe = await tx.document.count({ where: { ...activeDocuments, ownerId: req.user.id } });
  return {
    total: rows.length, accessible: rows.length, organizationTotal, uploadedByMe,
    mine, shared: rows.length - mine, pending,
    confidential: rows.filter(doc => ['Confidential', 'Restricted'].includes(doc.classification)).length,
    recent: rows.slice(0, 5), activity,
  };
}));
documents.get('/folders', endpoint(async (tx, req) => {
  const rows = await visibleDocuments(tx, req);
  return [...new Set(['General', ...rows.filter(doc => doc.allowed.includes('view')).map(doc => doc.folder)])].sort();
}));
const fileMime = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  png: 'image/png',
};

documents.get('/documents', endpoint(async (tx, req) => {
  const mode = z.enum(['all', 'mine', 'shared', 'manage']).default('all').parse(req.query.mode);
  const term = z.string().trim().max(160).default('').parse(req.query.q).toLowerCase();
  const filter = z.enum(['', 'sensitive', ...classifications]).default('').parse(req.query.classification);
  const fileType = z.enum(['', ...Object.keys(fileMime)]).default('').parse(req.query.fileType);
  const days = z.enum(['', '7', '30', '90']).default('').parse(req.query.uploadedWithin);
  const cutoff = days ? new Date(Date.now() - Number(days) * 86_400_000) : null;
  return (await visibleDocuments(tx, req)).filter(doc =>
    (!filter || (filter === 'sensitive' ? ['Confidential', 'Restricted'].includes(doc.classification) : doc.classification === filter)) &&
    doc.allowed.includes(mode === 'manage' ? 'manageAccess' : 'view') &&
    (mode !== 'mine' || doc.ownerId === req.user.id) &&
    (mode !== 'shared' || doc.ownerId !== req.user.id) &&
    (!fileType || doc.version.mime === fileMime[fileType]) &&
    (!cutoff || doc.version.createdAt >= cutoff) &&
    (!term || [doc.title, doc.version.fileName, doc.description, doc.folder, doc.classification]
      .some(value => value.toLowerCase().includes(term)))
  );
}));
documents.post('/documents', upload, endpoint(async (tx, req) => {
  requirePermission(req.user, 'upload');
  const data = uploadMetadata.parse(req.body);
  await sameOrg(tx, 'department', req.user.organizationId, data.departmentId);
  const document = await tx.document.create({ data: { ...data, ...scopes(req), ownerId: req.user.id } });
  const version = await saveVersion(tx, req, document.id, 1);
  await audit(tx, req.user, 'DOCUMENT_UPLOADED', document.id, { number: 1, sha256: version.sha256 });
  return viewModel(req.user, { ...document, versions: [version], grants: [] });
}));
documents.get('/documents/:id', endpoint(async (tx, req) => {
  const doc = await authorized(tx, req, 'view');
  await audit(tx, req.user, 'DOCUMENT_VIEWED', doc.id);
  return viewModel(req.user, doc);
}));
documents.get('/documents/:id/access', endpoint(async (tx, req) => {
  const doc = await findDoc(tx, req);
  return { allowed: actions.filter(action => documentAccess(req.user, doc, action)) };
}));
documents.patch('/documents/:id', endpoint(async (tx, req) => {
  const doc = await authorized(tx, req, 'edit');
  const data = metadata.partial().parse(req.body);
  if (data.classification !== undefined && data.classification !== doc.classification &&
      !documentAccess(req.user, doc, 'manageAccess')) throw fail(403, 'Manage Access is required to change classification.');
  await sameOrg(tx, 'department', req.user.organizationId, data.departmentId);
  await tx.document.update({ where: { id: doc.id }, data });
  await audit(tx, req.user, 'DOCUMENT_UPDATED', doc.id, { fields: Object.keys(data) });
}));
documents.delete('/documents/:id', endpoint(async (tx, req) => {
  const doc = await authorized(tx, req, 'delete');
  await tx.document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
  await audit(tx, req.user, 'DOCUMENT_DELETED', doc.id);
}));
documents.get('/documents/:id/versions', endpoint(async (tx, req) => {
  const doc = await authorized(tx, req, 'view');
  const versions = await tx.version.findMany({ where: { documentId: doc.id }, orderBy: { number: 'desc' }, omit: publicVersion });
  const uploaders = await tx.employee.findMany({
    where: { ...scopes(req), id: { in: versions.map(version => version.uploaderId) } }, select: { id: true, fullName: true },
  });
  return versions.map(version => ({ ...version, uploader: uploaders.find(user => user.id === version.uploaderId)?.fullName }));
}));
documents.post('/documents/:id/versions', upload, endpoint(async (tx, req) => {
  const doc = await authorized(tx, req, 'edit');
  const version = await saveVersion(tx, req, doc.id, doc.versions[0].number + 1);
  await audit(tx, req.user, 'DOCUMENT_UPDATED', doc.id, { number: version.number, sha256: version.sha256 });
  return version;
}));
documents.get('/documents/:id/versions/:number/verify', endpoint(async (tx, req) => {
  const doc = await authorized(tx, req, 'view');
  const version = await findVersion(tx, req, doc);
  const computed = sha256(await storage.read(version.storageKey));
  return { expected: version.sha256, computed, valid: computed === version.sha256 };
}));
documents.get('/documents/:id/versions/:number/preview/:page', endpoint(async (tx, req) => {
  const doc = await authorized(tx, req, 'view');
  const version = await findVersion(tx, req, doc);
  const page = z.coerce.number().int().positive().max(100000).parse(req.params.page);
  const bytes = await storage.read(version.storageKey);
  if (sha256(bytes) !== version.sha256) throw fail(409, 'Stored file integrity verification failed.');
  await audit(tx, req.user, 'DOCUMENT_VIEWED', doc.id, { number: version.number, page });
  return { deferred: () => renderPreview(bytes, version.mime, page) };
}));
for (const path of ['/documents/:id/download', '/documents/:id/versions/:number/download']) {
  documents.get(path, endpoint(async (tx, req) => {
    const doc = await authorized(tx, req, 'download');
    const version = await findVersion(tx, req, doc);
    const bytes = await storage.read(version.storageKey);
    if (sha256(bytes) !== version.sha256) throw fail(409, 'Stored file integrity verification failed.');
    await audit(tx, req.user, 'DOCUMENT_DOWNLOADED', doc.id, { number: version.number });
    return { bytes, mime: version.mime, fileName: version.fileName };
  }));
}

const rule = z.object({ kind: z.enum(['employee', 'department', 'role']), targetId: id, action: z.enum(actions), effect: z.enum(['allow', 'deny']) });
const ruleKey = ({ kind, targetId, action }) => [kind, targetId, action].join('/');
documents.get('/documents/:id/grants', endpoint(async (tx, req) => {
  const doc = await authorized(tx, req, 'manageAccess');
  return { title: doc.title, classification: doc.classification, grants: doc.grants };
}));
documents.put('/documents/:id/grants', endpoint(async (tx, req) => {
  const doc = await authorized(tx, req, 'manageAccess');
  const input = z.object({ grants: z.array(rule).max(500), original: z.array(rule).max(500) }).parse(req.body);
  const old = new Map(doc.grants.map(grant => [ruleKey(grant), grant.effect]));
  if (input.original.length !== old.size || new Set(input.original.map(ruleKey)).size !== old.size || input.original.some(grant => old.get(ruleKey(grant)) !== grant.effect)) {
    throw fail(409, 'Access rules changed. Reopen this screen before editing.');
  }
  const next = new Map(input.grants.map(grant => [ruleKey(grant), grant.effect]));
  if (next.size !== input.grants.length) throw fail(400, 'Each target and action may appear once.');
  for (const kind of ['role', 'department', 'employee']) {
    const ids = [...new Set(input.grants.filter(grant => grant.kind === kind).map(grant => grant.targetId))];
    if (ids.length && await tx[kind].count({ where: { ...scopes(req), id: { in: ids } } }) !== ids.length) {
      throw fail(400, 'A selected recipient does not belong to this organization.');
    }
  }
  await tx.grant.deleteMany({ where: { documentId: doc.id } });
  await tx.grant.createMany({ data: input.grants.map(grant => ({ ...grant, documentId: doc.id })) });
  const added = input.grants.filter(grant => grant.effect === 'allow' && old.get(ruleKey(grant)) !== 'allow');
  const removed = doc.grants.filter(grant => grant.effect === 'allow' && next.get(ruleKey(grant)) !== 'allow');
  const denialsChanged = [
    ...input.grants.filter(grant => grant.effect === 'deny' && old.get(ruleKey(grant)) !== 'deny'),
    ...doc.grants.filter(grant => grant.effect === 'deny' && next.get(ruleKey(grant)) !== 'deny'),
  ];
  if (added.length) await audit(tx, req.user, 'PERMISSION_GRANTED', doc.id, { rules: added });
  if (removed.length) await audit(tx, req.user, 'PERMISSION_REVOKED', doc.id, { rules: removed });
  if (denialsChanged.length) await audit(tx, req.user, 'PERMISSION_DENIAL_CHANGED', doc.id, { rules: denialsChanged });
  if (added.length || removed.length || denialsChanged.length) {
    await notify(tx, doc.organizationId, doc.ownerId, 'Access rules for one of your documents changed.');
    const individuals = new Set([...added, ...removed, ...denialsChanged].filter(grant => grant.kind === 'employee').map(grant => grant.targetId));
    for (const employeeId of individuals) {
      if (employeeId !== doc.ownerId) await notify(tx, doc.organizationId, employeeId, 'Your document access rules changed.');
    }
  }
}));

function notify(tx, organizationId, employeeId, message) {
  return tx.notification.create({ data: { organizationId, employeeId, message } });
}
async function listRequests(tx, req) {
  const managed = (await visibleDocuments(tx, req)).filter(doc => doc.allowed.includes('manageAccess'));
  const requests = await tx.accessRequest.findMany({
    where: { ...scopes(req), OR: [{ employeeId: req.user.id }, { documentId: { in: managed.map(doc => doc.id) }, status: 'pending' }] },
    orderBy: { createdAt: 'desc' },
  });
  const employees = await tx.employee.findMany({
    where: { ...scopes(req), id: { in: requests.map(request => request.employeeId) } },
    select: { id: true, fullName: true, employeeId: true },
  });
  return requests.map(request => {
    const doc = managed.find(item => item.id === request.documentId);
    return { ...request, title: doc?.title, requester: employees.find(item => item.id === request.employeeId), canResolve: !!doc };
  });
}
documents.get('/access-requests', endpoint(listRequests));
documents.post('/access-requests', endpoint(async (tx, req) => {
  requirePermission(req.user, 'view');
  const { documentId } = z.object({ documentId: id }).parse(req.body);
  req.params.id = documentId;
  const doc = await findDoc(tx, req);
  if (documentAccess(req.user, doc, 'view')) throw fail(409, 'You already have view access.');
  await tx.accessRequest.upsert({
    where: { documentId_employeeId: { documentId, employeeId: req.user.id } },
    create: { ...scopes(req), documentId, employeeId: req.user.id },
    update: { status: 'pending' },
  });
}));
documents.patch('/access-requests/:requestId', endpoint(async (tx, req) => {
  const request = await tx.accessRequest.findFirst({ where: { ...scopes(req), id: id.parse(req.params.requestId), status: 'pending' } });
  if (!request) throw fail(404, 'Pending request not found.');
  req.params.id = request.documentId;
  const doc = await authorized(tx, req, 'manageAccess');
  const { status } = z.object({ status: z.enum(['approved', 'declined']) }).parse(req.body);
  if (status === 'approved') {
    const employee = await tx.employee.findUnique({ where: { id: request.employeeId } });
    const role = employee?.roleId && await tx.role.findFirst({ where: { id: employee.roleId, ...scopes(req) } });
    const grant = { documentId: doc.id, kind: 'employee', targetId: request.employeeId, action: 'view' };
    const grants = [...doc.grants.filter(item => ruleKey(item) !== ruleKey(grant)), { ...grant, effect: 'allow' }];
    if (!employee || !documentAccess({ ...employee, permissions: role?.permissions ?? [] }, { ...doc, grants }, 'view')) {
      throw fail(409, 'The employee’s role or an applicable denial prevents view access.');
    }
    await tx.grant.upsert({
      where: { documentId_kind_targetId_action: grant }, create: { ...grant, effect: 'allow' }, update: { effect: 'allow' },
    });
    await audit(tx, req.user, 'PERMISSION_GRANTED', doc.id, { ...grant, requestId: request.id });
  }
  await tx.accessRequest.update({ where: { id: request.id }, data: { status } });
  await notify(tx, doc.organizationId, request.employeeId, 'Your document access request was ' + status + '.');
}));
