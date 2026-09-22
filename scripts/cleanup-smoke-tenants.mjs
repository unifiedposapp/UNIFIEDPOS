import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

// Smoke tenants created by scripts/smoke-global.mjs (org "Smoke Global Corp" /
// "P Corp", owner emails @example.test / @e.test). Dev-only cleanup helper.
const users = await p.user.findMany({
  where: { OR: [{ email: { contains: '@example.test' } }, { email: { endsWith: '@e.test' } }] },
  select: { id: true },
});
const userIds = users.map((u) => u.id);

const emps = await p.employee.findMany({ where: { userId: { in: userIds } }, select: { organizationId: true } });
const orgIds = [...new Set(emps.map((e) => e.organizationId).filter(Boolean))];
console.log('smoke users:', userIds.length, 'smoke orgs:', orgIds.length);
if (!orgIds.length && !userIds.length) {
  console.log('nothing to clean');
  await p.$disconnect();
  process.exit(0);
}

// Wipe rows scoped to those organizations across every table that carries an
// organizationId / createdByUserId style column, then the org/user rows
// themselves. session_replication_role=replica suppresses FK triggers so we do
// not have to compute a full dependency ordering for a 120-model schema.
const inList = (ids) => ids.map((x) => `'${String(x).replace(/[^0-9a-f-]/gi, '')}'`).join(',');
await p.$executeRawUnsafe(`SET session_replication_role = 'replica'`);
try {
  if (orgIds.length) {
    const orgTables = await p.$queryRaw`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='organizationId'`;
    for (const { table_name } of orgTables) {
      const t = String(table_name).replace(/[^a-z_]/gi, '');
      await p.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "organizationId" IN (${inList(orgIds)})`).catch(() => {});
    }
  }
  if (userIds.length) {
    const userTables = await p.$queryRaw`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='userId'`;
    for (const { table_name } of userTables) {
      const t = String(table_name).replace(/[^a-z_]/gi, '');
      await p.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "userId" IN (${inList(userIds)})`).catch(() => {});
    }
    await p.$executeRawUnsafe(`DELETE FROM users WHERE id IN (${inList(userIds)})`).catch(() => {});
  }
  if (orgIds.length) await p.$executeRawUnsafe(`DELETE FROM organizations WHERE id IN (${inList(orgIds)})`).catch(() => {});
} finally {
  await p.$executeRawUnsafe(`SET session_replication_role = 'origin'`);
}

console.log('remaining users:', await p.user.count());
console.log('remaining orgs:', await p.organization.count());
await p.$disconnect();
