import { PrismaClient } from '../generated/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { sha256 } from './storage.js';

export const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
export async function organizationTransaction(organizationId, operation) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`;
    return operation(tx);
  });
}

function hashEntry(entry) {
  return sha256(JSON.stringify([
    entry.organizationId, entry.sequence, entry.userId, entry.employeeId,
    entry.documentId, entry.action, entry.timestamp.toISOString(),
    entry.details, entry.previousHash,
  ]));
}
export async function audit(tx, user, action, documentId = null, details = {}) {
  const organizationId = user.organizationId;
  const previous = await tx.audit.findFirst({ where: { organizationId }, orderBy: { sequence: 'desc' } });
  const entry = {
    organizationId, sequence: (previous?.sequence ?? 0) + 1, userId: user.id,
    employeeId: user.employeeId, documentId, action, timestamp: new Date(),
    details: JSON.stringify(details), previousHash: previous?.hash ?? '',
  };
  return tx.audit.create({ data: { ...entry, hash: hashEntry(entry) } });
}
export function verifyChain(entries) {
  let previousHash = '';
  for (const [index, entry] of entries.entries()) {
    if (entry.sequence !== index + 1 || entry.previousHash !== previousHash || hashEntry(entry) !== entry.hash) {
      return { valid: false, sequence: entry.sequence };
    }
    previousHash = entry.hash;
  }
  return { valid: true, entries: entries.length, head: previousHash };
}
