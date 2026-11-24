import { z } from 'zod';
import { db, organizationTransaction, audit } from './database.js';
import { can } from './policy.js';

export const fail = (status, message) => Object.assign(new Error(message), { status });
export const label = z.string().trim().min(1).max(160);
export const id = z.uuid();
export const scopes = req => ({ organizationId: req.user.organizationId });

export async function member(tx, id) {
  const user = await tx.employee.findUnique({ where: { id }, omit: { passwordHash: true } });
  if (!user?.active) throw fail(401, 'Your session is no longer active.');
  const role = user.roleId && await tx.role.findFirst({ where: { id: user.roleId, organizationId: user.organizationId } });
  return { ...user, permissions: role?.permissions ?? [] };
}
export async function sessionUser(tx, claims) {
  const session = await tx.session.findUnique({ where: { id: claims.jti } });
  if (!session || session.employeeId !== claims.sub || session.expiresAt <= new Date()) {
    throw fail(401, 'Your session has expired.');
  }
  return member(tx, session.employeeId);
}

export const requirePermission = (user, permission) => {
  if (!can(user, permission)) throw fail(403, 'Your role does not permit this action.');
};
export const requireAdmin = user => {
  if (!user.admin) throw fail(403, 'Organization administrator access is required.');
};

export function endpoint(operation) {
  return async (req, res) => {
    const result = await organizationTransaction(req.user.organizationId, async tx => {
      req.user = await sessionUser(tx, req.claims);
      try {
        return await operation(tx, req);
      } catch (error) {
        if (error.status !== 403 && error.status !== 404) throw error;
        await audit(tx, req.user, 'ACCESS_FAILED', req.documentForAudit ?? null, { method: req.method, path: req.route.path });
        return { denied: error };
      }
    }).catch(async error => {
      const commitUnknown = ['P1001', 'P1002', 'P1017', 'P2028'].includes(error.code);
      if (!commitUnknown) {
        await req.rollbackFile?.().catch(cleanupError => console.error('File cleanup failed', cleanupError.code));
      }
      throw error;
    });
    if (result?.denied) throw result.denied;
    if (result?.deferred) {
      res.json(await result.deferred());
    } else if (result?.bytes) {
      res.type(result.mime).attachment(result.fileName).send(result.bytes);
    } else {
      res.json(result ?? { ok: true });
    }
  };
}
export async function sameOrg(tx, model, organizationId, value) {
  if (value && !await tx[model].findFirst({ where: { id: value, organizationId } })) {
    throw fail(400, 'The selected organization record is invalid.');
  }
}
export { db };
