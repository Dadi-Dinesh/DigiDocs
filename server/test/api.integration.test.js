import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { createHash, randomBytes } from 'node:crypto';

const origin = process.env.DOCUVAULT_TEST_URL;

function samplePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
    return offset;
  });
  const start = pdf.length;
  pdf += 'xref\n0 4\n0000000000 65535 f \n';
  for (const offset of offsets) pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n';
  return Buffer.from(pdf, 'ascii');
}
test('DocuVault API against an isolated test database', { skip: !origin }, async () => {
  const salt = randomBytes(5).toString('hex');
  const password = 'integration-only-password';
  async function request(method, path, { token, data, status = 200 } = {}) {
    const response = await fetch(origin + '/api' + path, {
      method,
      headers: {
        ...(token && { Authorization: 'Bearer ' + token }),
        ...(data && !(data instanceof FormData) && { 'Content-Type': 'application/json' }),
      },
      body: data instanceof FormData ? data : data ? JSON.stringify(data) : undefined,
    });
    const body = response.headers.get('content-type')?.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, status, method + ' ' + path + ' ' + (Buffer.isBuffer(body) ? '' : JSON.stringify(body)));
    return body;
  }

  async function register(slug) {
    return (await request('POST', '/auth/register', {
      data: { slug, name: slug, employeeId: 'ADMIN', fullName: 'Test Admin', email: 'admin@example.org', password },
      status: 201,
    })).token;
  }
  const slug = 'integration-' + salt;
  const admin = await register(slug);
  const outsider = await register('outside-' + salt);
  const employeeId = 'EMP1024';
  const role = await request('POST', '/roles', { token: admin, data: { name: 'Reviewer', permissions: ['view', 'download'] } });
  const department = await request('POST', '/departments', { token: admin, data: { name: 'Finance' } });
  const member = await request('POST', '/employees', { token: admin, data: {
    employeeId, fullName: 'Test Reviewer', email: 'reviewer@example.org', designation: 'Analyst', departmentId: department.id, roleId: role.id, password,
  } });
  const employee = (await request('POST', '/auth/login', { data: { slug, employeeId, password } })).token;
  const emailLogin = await request('POST', '/auth/login', { data: { slug, email: '  ' + member.email.toUpperCase() + '  ', password } });
  await request('POST', '/auth/login', { data: { slug, email: member.email, password: 'incorrect' }, status: 401 });
  await request('GET', '/auth/me', { status: 401 });
  await request('POST', '/auth/register', {
    data: { slug: 'bad code', name: 'Invalid', employeeId: 'ADMIN', fullName: 'Invalid User', email: 'invalid', password },
    status: 400,
  });
  assert.equal((await request('GET', '/auth/me', { token: emailLogin.token })).id, member.id);
  await request('POST', '/auth/login', { data: { slug: 'outside-' + salt, email: member.email, password }, status: 401 });
  const profile = await request('GET', '/auth/me', { token: employee });
  assert.equal(profile.fullName, member.fullName);
  assert.equal(profile.employeeId, employeeId);
  assert.equal(profile.email, member.email);
  assert.equal(profile.departmentName, department.name);
  assert.equal(profile.roleName, role.name);
  assert.equal(profile.active, true);
  assert.equal(Object.hasOwn(profile, 'passwordHash'), false);
  const adminProfile = await request('GET', '/auth/me', { token: admin });
  assert.equal(adminProfile.roleName, 'Organization Administrator');
  assert.equal(adminProfile.departmentName, null);
  const byDepartment = await request('GET', '/employees?q=Finance', { token: admin });
  assert.deepEqual(byDepartment.map(item => item.employeeId), [employeeId]);
  assert.equal(Object.hasOwn(member, 'passwordHash'), false);
  const pdf = samplePdf();
  const fileForm = (bytes, fields = {}, name = 'retention.pdf') => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    data.set('file', new Blob([bytes]), name);
    return data;
  };
  const fields = { title: 'Retention policy', description: 'Records schedule', folder: 'Policies', departmentId: department.id, classification: 'Internal' };
  await request('POST', '/documents', { token: admin, data: fileForm('invalid', fields), status: 415 });
  const doc = await request('POST', '/documents', { token: admin, data: fileForm(pdf, fields) });
  const path = '/documents/' + doc.id;
  assert.equal(doc.version.sha256, createHash('sha256').update(pdf).digest('hex'));
  assert.equal(Object.hasOwn(doc.version, 'storageKey'), false);
  const search = async (token, term, filters = '') =>
    (await request('GET', '/documents?q=' + encodeURIComponent(term) + filters, { token })).map(item => item.id);
  assert.deepEqual(await request('GET', '/documents', { token: employee }), []);
  assert.deepEqual(await search(employee, 'Records schedule', '&fileType=pdf&uploadedWithin=7'), []);
  assert.deepEqual(await search(outsider, 'Records schedule'), []);
  await request('GET', path, { token: employee, status: 403 });
  await request('GET', path, { token: outsider, status: 404 });
  const adminDashboard = await request('GET', '/dashboard', { token: admin });
  assert.equal(adminDashboard.organizationTotal, 1);
  assert.equal(adminDashboard.accessible, 1);
  assert.equal(adminDashboard.uploadedByMe, 1);
  assert.ok(adminDashboard.activity.some(item => item.action === 'DOCUMENT_UPLOADED'));

  const employeeDashboard = await request('GET', '/dashboard', { token: employee });
  assert.equal(employeeDashboard.organizationTotal, null);
  assert.equal(employeeDashboard.accessible, 0);
  assert.equal(employeeDashboard.uploadedByMe, 0);
  assert.ok(employeeDashboard.activity.every(item => item.employeeId === employeeId));
  assert.equal((await request('GET', '/dashboard', { token: outsider })).organizationTotal, 0);

  await request('GET', '/employees?q=Finance', { token: outsider }).then(rows => assert.deepEqual(rows, []));

  const changeGrants = (grants, original = [], status = 200) =>
    request('PUT', path + '/grants', { token: admin, data: { grants, original }, status });
  const allows = [
    { kind: 'role', targetId: role.id, action: 'view', effect: 'allow' },
    { kind: 'department', targetId: department.id, action: 'download', effect: 'allow' },
  ];
  const deny = { kind: 'employee', targetId: member.id, action: 'download', effect: 'deny' };
  const foreignRole = await request('POST', '/roles', { token: outsider, data: { name: 'Foreign role', permissions: ['view'] } });
  await changeGrants([{ ...allows[0], targetId: foreignRole.id }], [], 400);
  await request('PUT', path + '/grants', { token: employee, data: { grants: allows, original: [] }, status: 403 });
  await changeGrants(allows);
  const grantSummary = await request('GET', path + '/grants', { token: admin });
  assert.ok(grantSummary.grants.some(grant => grant.kind === 'role' && grant.recipientName === role.name));
  assert.ok(grantSummary.grants.some(grant => grant.kind === 'department' && grant.recipientName === department.name));
  for (const term of ['RETENTION POLICY', 'retention.pdf', '  rEcOrDs ScHeDuLe  ']) {
    assert.deepEqual(await search(employee, term, '&mode=shared&classification=Internal'), [doc.id]);
  }
  assert.deepEqual(await search(employee, 'Records schedule', '&mode=mine'), []);
  assert.deepEqual(await search(employee, 'Records schedule', '&classification=Public'), []);
  assert.deepEqual(await search(employee, 'Records schedule', '&classification=Internal&fileType=pdf&uploadedWithin=7'), [doc.id]);
  assert.deepEqual(await search(employee, 'Records schedule', '&fileType=jpg&uploadedWithin=30'), []);
  await request('GET', '/documents?uploadedWithin=999', { token: employee, status: 400 });
  await request('GET', '/documents?fileType=zip', { token: employee, status: 400 });
  assert.deepEqual(await search(employee, 'no such document'), []);
  assert.deepEqual(await search(employee, ''), [doc.id]);
  assert.equal((await request('GET', '/dashboard', { token: employee })).accessible, 1);
  await changeGrants([], [], 409);
  assert.equal((await request('GET', path, { token: employee })).title, fields.title);
  assert.deepEqual(await request('GET', path + '/download', { token: employee }), pdf);
  const activityPath = '/audit/activity';
  const ownActivity = await request('GET', activityPath, { token: employee });
  assert.ok(ownActivity.some(event => event.action === 'DOCUMENT_DOWNLOADED'));
  assert.ok(ownActivity.every(event => event.employeeId === employeeId &&
    event.employeeName === member.fullName && event.documentName === fields.title &&
    !Object.hasOwn(event, 'details') && Number.isFinite(Date.parse(event.timestamp))));
  assert.deepEqual(await request('GET', activityPath, { token: outsider }), []);
  await request('GET', activityPath, { status: 401 });
  await request('GET', '/audit', { token: employee, status: 403 });
  await changeGrants([...allows, deny], allows);
  await request('GET', path + '/download', { token: employee, status: 403 });
  const preview = await request('GET', path + '/versions/1/preview/1', { token: employee });
  assert.equal(preview.kind, 'image');
  assert.deepEqual(Object.keys(preview).sort(), ['data', 'height', 'kind', 'page', 'pages', 'width']);
  await request('GET', path + '/versions/1/preview/1', { status: 401 });
  await request('GET', path + '/versions/1/preview/1', { token: outsider, status: 404 });
  assert.equal(preview.pages, 1);
  assert.equal(Buffer.from(preview.data, 'base64').subarray(1, 4).toString(), 'PNG');
  await request('PATCH', path, { token: admin, data: { classification: 'Restricted' } });
  const updated = await request('GET', path, { token: admin });
  assert.equal(updated.description, fields.description);
  assert.equal(updated.folder, fields.folder);
  assert.equal(updated.departmentId, department.id);
  assert.deepEqual(await request('GET', '/folders', { token: employee }), ['General']);
  await request('GET', path, { token: employee, status: 403 });
  await request('GET', path + '/versions/1/preview/1', { token: employee, status: 403 });
  await request('POST', '/access-requests', { token: employee, data: { documentId: doc.id } });
  const pending = await request('GET', '/access-requests', { token: admin });
  assert.equal(pending.length, 1);
  await request('PATCH', '/access-requests/' + pending[0].id, { token: admin, data: { status: 'approved' } });
  assert.equal((await request('GET', path, { token: employee })).title, fields.title);
  assert.ok((await request('GET', '/notifications', { token: employee })).length > 0);

  const version = await request('POST', path + '/versions', { token: admin, data: fileForm(Buffer.concat([pdf, Buffer.from('\n% revised')])) });
  assert.equal(version.number, 2);
  assert.notEqual(version.sha256, doc.version.sha256);
  assert.equal((await request('GET', path + '/versions', { token: employee })).length, 2);
  const verifyPath = path + '/versions/1/verify';
  assert.deepEqual(await request('GET', verifyPath, { token: employee }), {
    expected: doc.version.sha256, computed: doc.version.sha256, valid: true,
  });
  assert.equal((await request('GET', path + '/versions/2/verify', { token: employee })).computed, version.sha256);
  await request('GET', verifyPath, { status: 401 });
  await request('GET', verifyPath, { token: outsider, status: 404 });
  const testStorage = process.env.DOCUVAULT_TEST_STORAGE_DIR;
  if (testStorage) {
    const originals = [];
    for (const entry of await readdir(testStorage, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = join(testStorage, entry.name);
      if ((await readFile(file)).equals(pdf)) originals.push(file);
    }
    assert.equal(originals.length, 1, 'Use a fresh storage directory for the tamper check.');
    const altered = Buffer.concat([pdf, Buffer.from('changed after upload')]);
    try {
      await writeFile(originals[0], altered);
      assert.deepEqual(await request('GET', verifyPath, { token: employee }), {
        expected: doc.version.sha256, computed: createHash('sha256').update(altered).digest('hex'), valid: false,
      });
    } finally {
      await writeFile(originals[0], pdf);
    }
  }
  const saved = await request('GET', path + '/grants', { token: admin });
  await changeGrants([], saved.grants);
  await request('GET', verifyPath, { token: employee, status: 403 });
  assert.deepEqual(await request('GET', activityPath, { token: employee }), []);
  const organizationActivity = await request('GET', activityPath, { token: admin });
  for (const action of ['DOCUMENT_UPLOADED', 'DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED', 'PERMISSION_GRANTED', 'PERMISSION_REVOKED']) {
    assert.ok(organizationActivity.some(event => event.action === action && event.documentName === fields.title), action);
  }
  assert.deepEqual(organizationActivity.map(event => event.sequence),
    organizationActivity.map(event => event.sequence).sort((a, b) => b - a));
  assert.deepEqual(await search(employee, 'Records schedule'), []);
  assert.equal((await request('GET', '/dashboard', { token: employee })).accessible, 0);
  await request('GET', path, { token: employee, status: 403 });
  await request('PATCH', '/roles/' + role.id, { token: admin, data: {
    name: role.name, permissions: ['view', 'upload', 'manageAccess'],
  } });
  const owned = await request('POST', '/documents', { token: employee, data: fileForm(pdf, fields) });
  const ownedGrants = '/documents/' + owned.id + '/grants';
  const adminId = adminProfile.id;
  const individual = { kind: 'employee', targetId: adminId, action: 'view', effect: 'allow' };
  const excessive = { ...individual, action: 'download' };
  const ownerSummary = await request('GET', ownedGrants, { token: employee });
  assert.ok(ownerSummary.editableActions.includes('view'));
  assert.ok(!ownerSummary.editableActions.includes('download'));
  await request('PUT', ownedGrants, { token: employee, data: { grants: [excessive], original: [] }, status: 403 });
  await request('PUT', ownedGrants, { token: employee, data: { grants: [individual], original: [] } });
  const stored = await request('GET', ownedGrants, { token: employee });
  assert.equal(stored.grants[0].recipientName, adminProfile.employeeId + ' · ' + adminProfile.fullName);
  await request('PUT', ownedGrants, { token: employee, data: { grants: [], original: stored.grants } });
  await request('PATCH', '/employees/' + member.id, { token: admin, data: { active: false } });
  await request('GET', '/auth/me', { token: employee, status: 401 });

  for (const extension of ['docx', 'xlsx', 'png', 'jpg']) {
    const text = ['docx', 'xlsx'].includes(extension);
    const name = 'sample.' + extension;
    const bytes = text ? await readFile(new URL('./fixtures/' + name, import.meta.url)) :
      await sharp({ create: { width: 16, height: 16, channels: 3, background: '#6475F5' } })
        .toFormat(extension === 'jpg' ? 'jpeg' : 'png').toBuffer();
    const doc = await request('POST', '/documents', { token: admin, data: fileForm(bytes, fields, name) });
    const previewPath = '/documents/' + doc.id + '/versions/1/preview/1';
    const result = await request('GET', previewPath, { token: admin, status: text ? 415 : 200 });
    if (text) assert.match(result.error, /PDF, JPG, and PNG/);
    else assert.equal(result.kind, 'image');
  }

  await request('DELETE', path, { token: admin });
  await request('GET', path, { token: admin, status: 404 });
  const audit = await request('GET', '/audit', { token: admin });
  for (const action of ['LOGIN', 'ACCESS_FAILED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED', 'DOCUMENT_UPDATED', 'DOCUMENT_DELETED', 'PERMISSION_GRANTED', 'PERMISSION_REVOKED']) {
    assert.ok(audit.some(event => event.action === action), action);
  }
  assert.equal((await request('GET', '/audit/verify', { token: admin })).valid, true);
  await request('POST', '/auth/logout', { token: admin });
  await request('GET', '/auth/me', { token: admin, status: 401 });
});
