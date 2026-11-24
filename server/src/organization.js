import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { email, password } from './auth.js';
import { endpoint, fail, id, label, requireAdmin, requirePermission, sameOrg, scopes } from './http.js';
import { can, permissions } from './policy.js';
import { verifyChain } from './database.js';

export const organization = Router();
const departmentInput = z.object({ name: label });
const roleInput = departmentInput.extend({ permissions: z.array(z.enum(permissions)).max(permissions.length) });
const employeeInput = z.object({
  fullName: label, employeeId: label.transform(value => value.toUpperCase()), email, designation: label,
  roleId: id.nullable(), departmentId: id.nullable(), joiningDate: z.iso.date().transform(value => new Date(value)).optional(),
});
const safe = { passwordHash: true };

organization.get('/organization', endpoint((tx, req) => tx.organization.findUniqueOrThrow({ where: { id: req.user.organizationId } })));
organization.patch('/organization', endpoint((tx, req) => {
  requireAdmin(req.user);
  const data = z.object({ name: label, description: z.string().max(2000) }).parse(req.body);
  return tx.organization.update({ where: { id: req.user.organizationId }, data });
}));

for (const [path, model, schema] of [['departments', 'department', departmentInput], ['roles', 'role', roleInput]]) {
  organization.get('/' + path, endpoint((tx, req) => tx[model].findMany({ where: scopes(req), orderBy: { name: 'asc' } })));
  organization.post('/' + path, endpoint((tx, req) => {
    requireAdmin(req.user);
    return tx[model].create({ data: { ...schema.parse(req.body), ...scopes(req) } });
  }));
  organization.patch('/' + path + '/:id', endpoint(async (tx, req) => {
    requireAdmin(req.user);
    const key = id.parse(req.params.id);
    await sameOrg(tx, model, req.user.organizationId, key);
    return tx[model].update({ where: { id: key }, data: schema.parse(req.body) });
  }));
}

organization.get('/employees', endpoint(async (tx, req) => {
  const manager = can(req.user, 'manageEmployees');
  if (!manager && !can(req.user, 'manageAccess')) throw fail(403, 'Employee directory access is restricted.');
  const query = z.string().trim().max(160).optional().parse(req.query.q);
  const where = { ...scopes(req), ...(manager ? {} : { active: true }) };
  if (query) {
    const contains = { contains: query, mode: 'insensitive' };
    const departments = await tx.department.findMany({ where: { ...scopes(req), name: contains }, select: { id: true } });
    where.OR = [
      { employeeId: contains }, { fullName: contains }, { designation: contains },
      { departmentId: { in: departments.map(item => item.id) } },
    ];
  }
  const common = { where, orderBy: { fullName: 'asc' } };
  return manager ? tx.employee.findMany({ ...common, omit: safe }) :
    tx.employee.findMany({ ...common, select: { id: true, employeeId: true, fullName: true } });
}));
organization.post('/employees', endpoint(async (tx, req) => {
  requirePermission(req.user, 'manageEmployees');
  const { password: plain, ...data } = employeeInput.extend({ password }).parse(req.body);
  if (data.roleId) requireAdmin(req.user);
  await sameOrg(tx, 'role', req.user.organizationId, data.roleId);
  await sameOrg(tx, 'department', req.user.organizationId, data.departmentId);
  return tx.employee.create({ data: { ...data, ...scopes(req), passwordHash: await bcrypt.hash(plain, 12) }, omit: safe });
}));
organization.patch('/employees/:id', endpoint(async (tx, req) => {
  requirePermission(req.user, 'manageEmployees');
  const key = id.parse(req.params.id);
  const data = employeeInput.partial().extend({ active: z.boolean().optional() }).parse(req.body);
  const existing = await tx.employee.findFirst({ where: { ...scopes(req), id: key } });
  if (!existing) throw fail(404, 'Employee not found.');
  if (existing.admin) throw fail(403, 'The founding administrator account is protected.');
  if (data.roleId !== undefined && data.roleId !== existing.roleId) requireAdmin(req.user);
  if (data.departmentId !== undefined && data.departmentId !== existing.departmentId) requireAdmin(req.user);
  await sameOrg(tx, 'role', req.user.organizationId, data.roleId);
  await sameOrg(tx, 'department', req.user.organizationId, data.departmentId);
  if (data.active === false) await tx.session.deleteMany({ where: { employeeId: key } });
  return tx.employee.update({ where: { id: key }, data, omit: safe });
}));

organization.get('/audit', endpoint((tx, req) => {
  requirePermission(req.user, 'audit');
  return tx.audit.findMany({ where: scopes(req), orderBy: { sequence: 'desc' }, take: 100 });
}));
organization.get('/audit/verify', endpoint(async (tx, req) => {
  requirePermission(req.user, 'audit');
  return verifyChain(await tx.audit.findMany({ where: scopes(req), orderBy: { sequence: 'asc' } }));
}));
organization.get('/notifications', endpoint((tx, req) => tx.notification.findMany({
  where: { ...scopes(req), employeeId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100,
})));
organization.patch('/notifications/read', endpoint((tx, req) => tx.notification.updateMany({
  where: { ...scopes(req), employeeId: req.user.id, read: false }, data: { read: true },
})));
