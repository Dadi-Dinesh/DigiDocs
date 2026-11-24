import bcrypt from 'bcrypt';

const slug = 'docuvault-demo';
const name = 'DocuVault Demo';
const description = 'Organization for the DocuVault product demonstration.';
const accounts = [
  { employeeId: 'ADMIN', email: 'admin@docuvault.demo', fullName: 'Demo Admin', designation: 'Organization Administrator', passwordEnv: 'DEMO_ADMIN_PASSWORD' },
  { employeeId: 'MANAGER', email: 'manager@docuvault.demo', fullName: 'Demo Manager', designation: 'Document Manager', passwordEnv: 'DEMO_MANAGER_PASSWORD', role: 'Manager', permissions: ['view', 'download', 'upload', 'edit', 'manageAccess'] },
  { employeeId: 'EMPLOYEE', email: 'employee@docuvault.demo', fullName: 'Demo Employee', designation: 'Employee', passwordEnv: 'DEMO_EMPLOYEE_PASSWORD', role: 'Employee', permissions: ['view', 'download'] },
];

async function seed() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in server/.env first.');
  const { db } = await import('../src/database.js');
  try {
    const results = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'seed:' + slug}, 0))`;
      let organization = await tx.organization.findUnique({ where: { slug } });
      if (organization && (organization.name !== name || organization.description !== description)) {
        throw new Error('The demo organization code belongs to another organization. No changes were made.');
      }
      organization ??= await tx.organization.create({ data: { slug, name, description } });
      const organizationId = organization.id;
      const departmentKey = { organizationId, name: 'Demo Operations' };
      const department = await tx.department.findUnique({ where: { organizationId_name: departmentKey } }) ??
        await tx.department.create({ data: departmentKey });

      const results = [];
      for (const account of accounts) {
        let roleId = null;
        if (account.role) {
          const key = { organizationId, name: account.role };
          const role = await tx.role.findUnique({ where: { organizationId_name: key } }) ??
            await tx.role.create({ data: { ...key, permissions: account.permissions } });
          if (!samePermissions(role.permissions, account.permissions)) {
            throw new Error(`Existing ${account.role} permissions differ. No changes were made.`);
          }
          roleId = role.id;
        }
        const { employeeId, email, fullName, designation, password } = account;
        const admin = !account.role;
        const existing = await tx.employee.findMany({
          where: { organizationId, OR: [{ employeeId }, { email }] },
        });
        if (existing.length) {
          const [employee] = existing;
          if (existing.length !== 1 || employee.employeeId !== employeeId || employee.email !== email ||
              employee.admin !== admin || employee.roleId !== roleId || !employee.active ||
              !await bcrypt.compare(password, employee.passwordHash)) {
            throw new Error(`Existing account ${email} differs from the demo configuration. No changes were made.`);
          }
          results.push(`Unchanged: ${email}`);
          continue;
        }
        const passwordHash = await bcrypt.hash(password, 12);
        await tx.employee.create({
          data: { organizationId, departmentId: department.id, employeeId, email, fullName, designation, admin, roleId, passwordHash },
        });
        results.push(`Created: ${email}`);
      }
      return results;
    }, { maxWait: 15_000, timeout: 30_000 });
    for (const result of results) console.log(result);
  } finally {
    await db.$disconnect();
  }
}

function samePermissions(actual, expected) {
  return actual.length === expected.length && expected.every(permission => actual.includes(permission));
}

async function verify() {
  const origin = (process.env.DOCUVAULT_DEMO_API_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
  for (const account of accounts) {
    async function request(path, options) {
      const response = await fetch(origin + '/api/auth/' + path, { ...options, signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error(`${account.email}: ${path} returned HTTP ${response.status}.`);
      return response.json();
    }
    const { token } = await request('login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, email: account.email, password: account.password }),
    });
    if (typeof token !== 'string' || token.split('.').length !== 3) {
      throw new Error(`${account.email}: login did not return a JWT.`);
    }
    const headers = { Authorization: 'Bearer ' + token };
    const roleName = account.role ?? 'Organization Administrator';
    try {
      const profile = await request('me', { headers });
      if (profile.email !== account.email || profile.employeeId !== account.employeeId ||
          profile.roleName !== roleName || profile.admin !== !account.role || !profile.active ||
          (account.permissions && !samePermissions(profile.permissions, account.permissions))) {
        throw new Error(`${account.email}: authenticated profile does not match the requested role.`);
      }
    } finally {
      await request('logout', { method: 'POST', headers });
    }
    console.log(`Verified: ${account.email} (${roleName})`);
  }
}

try {
  for (const account of accounts) {
    const password = process.env[account.passwordEnv];
    if (!password || Buffer.byteLength(password) > 72) {
      throw new Error(`Set ${account.passwordEnv} to the demo password (at most 72 bytes).`);
    }
    account.password = password;
  }
  if (process.argv[2] === 'seed') await seed();
  else if (process.argv[2] === 'verify') await verify();
  else throw new Error('Use the demo:seed or demo:verify npm script.');
} catch (error) {
  const message = error.code || (error.name === 'Error' && !error.clientVersion && !error.cause ? error.message : error.name);
  console.error('Demo command failed:', message);
  process.exitCode = 1;
}
