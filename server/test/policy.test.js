import test from 'node:test';
import assert from 'node:assert/strict';
import { documentAccess } from '../src/policy.js';

const user = {
  id: 'employee', roleId: 'role', departmentId: 'department', organizationId: 'organization',
  active: true, admin: false, permissions: ['view'],
};
const document = { organizationId: 'organization', ownerId: 'author', classification: 'Internal', grants: [] };
const grant = (kind, effect = 'allow') => ({ kind, targetId: kind, action: 'view', effect });

test('requires active same-organization membership and the role capability', () => {
  const shared = { ...document, grants: [grant('role')] };
  for (const actor of [{ ...user, active: false }, { ...user, organizationId: 'another' }, { ...user, permissions: [] }]) {
    assert.equal(documentAccess(actor, shared, 'view'), false);
  }
  assert.equal(documentAccess(user, shared, 'view'), true);
  assert.equal(documentAccess(user, shared, 'download'), false);
});

test('any applicable denial takes precedence, including over owner access', () => {
  for (const kind of ['employee', 'department', 'role']) {
    assert.equal(documentAccess(user, { ...document, ownerId: user.id, grants: [grant('employee'), grant(kind, 'deny')] }, 'view'), false);
  }
});

test('classification restricts the scope of allows', () => {
  const outcomes = {
    Public: [true, true, true], Internal: [true, true, true],
    Confidential: [true, false, true], Restricted: [true, false, false],
  };
  for (const [classification, permitted] of Object.entries(outcomes)) {
    ['employee', 'department', 'role'].forEach((kind, index) => {
      assert.equal(documentAccess(user, { ...document, classification, grants: [grant(kind)] }, 'view'), permitted[index]);
    });
  }
});
