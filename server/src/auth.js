import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { audit, organizationTransaction } from './database.js';
import { db, endpoint, fail, label, sessionUser } from './http.js';

export const password = z.string().min(12).refine(value => Buffer.byteLength(value) <= 72, 'Password must be at most 72 bytes.');
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,49}$/);
export const email = z.email().max(254).transform(value => value.toLowerCase());
const employeeId = label.transform(value => value.toUpperCase());
const existingPassword = z.string().min(1).refine(value => Buffer.byteLength(value) <= 72, 'Password must be at most 72 bytes.');
const credentials = z.object({ slug, employeeId, password: existingPassword });
const registration = credentials.extend({ password, fullName: label, email, name: label, description: z.string().max(2000).default('') });
const secret = process.env.JWT_SECRET;
const jwtOptions = { issuer: 'docuvault-api', audience: 'docuvault-mobile' };
const sessionSeconds = 60 * 60 * 12;
const fallbackHash = await bcrypt.hash(randomUUID(), 12);

async function issue(tx, user) {
  const jti = randomUUID();
  await tx.session.create({ data: { id: jti, employeeId: user.id, expiresAt: new Date(Date.now() + sessionSeconds * 1000) } });
  await audit(tx, user, 'LOGIN');
  return { token: jwt.sign({}, secret, { ...jwtOptions, algorithm: 'HS256', subject: user.id, jwtid: jti, expiresIn: sessionSeconds }) };
}

export const auth = Router();
const rate = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, message: { error: 'Too many attempts. Try again later.' } });
auth.post('/register', rate, async (req, res) => {
  const { slug, name, description, password: plain, ...employee } = registration.parse(req.body);
  const passwordHash = await bcrypt.hash(plain, 12);
  const result = await db.$transaction(async tx => {
    const org = await tx.organization.create({ data: { slug, name, description } });
    const user = await tx.employee.create({ data: { ...employee, organizationId: org.id, designation: 'Organization Administrator', admin: true, passwordHash } });
    return issue(tx, user);
  });
  res.status(201).json(result);
});
auth.post('/login', rate, async (req, res) => {
  const { slug, employeeId, password } = credentials.parse(req.body);
  const org = await db.organization.findUnique({ where: { slug } });
  const candidate = org && await db.employee.findFirst({ where: { organizationId: org.id, employeeId } });
  const matches = await bcrypt.compare(password, candidate?.passwordHash ?? fallbackHash);
  if (!matches || !candidate?.active) {
    if (candidate) await organizationTransaction(org.id, tx => audit(tx, candidate, 'ACCESS_FAILED', null, { operation: 'login' }));
    throw fail(401, 'Invalid organization, Employee ID or password.');
  }
  const result = await organizationTransaction(org.id, async tx => {
    const current = await tx.employee.findUnique({ where: { id: candidate.id } });
    if (!current?.active || current.passwordHash !== candidate.passwordHash) throw fail(401, 'Invalid credentials.');
    return issue(tx, current);
  });
  res.json(result);
});
export async function authenticate(req, _res, next) {
  try {
    req.claims = jwt.verify(req.get('authorization')?.match(/^Bearer (.+)$/)?.[1], secret, { ...jwtOptions, algorithms: ['HS256'] });
  } catch {
    throw fail(401, 'Sign in to continue.');
  }
  req.user = await sessionUser(db, req.claims);
  next();
}
auth.get('/me', authenticate, endpoint(async (tx, req) => {
  const { departmentId, organizationId } = req.user;
  const department = departmentId ? await tx.department.findFirst({
    where: { id: departmentId, organizationId }, select: { name: true },
  }) : null;
  return { ...req.user, departmentName: department?.name ?? null };
}));
auth.post('/logout', authenticate, endpoint((tx, req) => tx.session.deleteMany({ where: { id: req.claims.jti } })));
auth.patch('/password', authenticate, endpoint(async (tx, req) => {
  const input = z.object({ current: existingPassword, replacement: password }).parse(req.body);
  const employee = await tx.employee.findUnique({ where: { id: req.user.id } });
  if (!await bcrypt.compare(input.current, employee.passwordHash)) throw fail(400, 'Current password is incorrect.');
  await tx.employee.update({ where: { id: employee.id }, data: { passwordHash: await bcrypt.hash(input.replacement, 12) } });
  await tx.session.deleteMany({ where: { employeeId: employee.id, id: { not: req.claims.jti } } });
}));
