import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  await changeGrants(allows);
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
  await changeGrants([...allows, deny], allows);
  await request('GET', path + '/download', { token: employee, status: 403 });
  const preview = await request('GET', path + '/versions/1/preview/1', { token: employee });
  assert.equal(preview.kind, 'image');
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
  assert.equal((await request('GET', path + '/versions/1/verify', { token: employee })).valid, true);
  const saved = await request('GET', path + '/grants', { token: admin });
  await changeGrants([], saved.grants);
  assert.deepEqual(await search(employee, 'Records schedule'), []);
  assert.equal((await request('GET', '/dashboard', { token: employee })).accessible, 0);
  await request('GET', path, { token: employee, status: 403 });
  await request('PATCH', '/employees/' + member.id, { token: admin, data: { active: false } });
  await request('GET', '/auth/me', { token: employee, status: 401 });

  for (const extension of ['docx', 'xlsx', 'png', 'jpg']) {
    const text = ['docx', 'xlsx'].includes(extension);
    const name = 'sample.' + extension;
    const bytes = text ? await readFile(new URL('./fixtures/' + name, import.meta.url)) :
      await sharp({ create: { width: 16, height: 16, channels: 3, background: '#6475F5' } })
        .toFormat(extension === 'jpg' ? 'jpeg' : 'png').toBuffer();
    const doc = await request('POST', '/documents', { token: admin, data: fileForm(bytes, fields, name) });
    const result = await request('GET', '/documents/' + doc.id + '/versions/1/preview/1', { token: admin });
    assert.equal(result.kind, text ? 'text' : 'image');
    if (text) assert.match(result.lines.join('\n'), /DocuVault preview/);
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
