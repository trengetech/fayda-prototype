#!/usr/bin/env node
// Removes everything the demo seed created, and nothing else. Run from apps/api so .env is found:
//   cd apps/api && node --env-file=.env ../../infra/seed/unseed-demo.mjs          (dry run: prints counts only)
//   cd apps/api && node --env-file=.env ../../infra/seed/unseed-demo.mjs --delete (deletes, in one transaction)
// How: start from the 5 seed users, follow every foreign key to find all rows that belong to them
// (directly or through other rows), then delete children first. Other users' rows are never touched.
// Uploaded picture files stay on the API server's disk (harmless, unreferenced).
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const postgres = require('postgres').default ?? require('postgres');

const PHONES = ['9000011111', '9000033333', '9000022222', '9876543210', '9123456789'];
const doDelete = process.argv.includes('--delete');
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { max: 1 });

const users = (await sql`select id, phone from public.users`).filter((u) => PHONES.some((p) => u.phone.includes(p)));
console.log(`seed users found: ${users.length}`);
if (users.length === 0) { await sql.end(); process.exit(0); }

const fks = await sql`
  select c.conname, c.conrelid::regclass::text child, c.confrelid::regclass::text parent,
         (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]) child_col,
         (select attname from pg_attribute where attrelid = c.confrelid and attnum = c.confkey[1]) parent_col,
         array_length(c.conkey, 1) n
  from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace`;
if (fks.some((f) => f.n > 1)) throw new Error('composite foreign key found: extend this script before using it');

// owned[table] = Map(parentColValue set) is keyed by table name; we track primary-key "id" values.
const owned = { users: new Set(users.map((u) => u.id)) };
const idOf = async (table) => (await sql`select 1 from information_schema.columns where table_schema='public' and table_name=${table} and column_name='id'`).length > 0;
let changed = true;
while (changed) {
  changed = false;
  for (const f of fks) {
    const parentIds = owned[f.parent];
    if (!parentIds || parentIds.size === 0) continue;
    const hasId = await idOf(f.child);
    const vals = [...parentIds];
    // the parent column is `id` for every table here; a different parent column is not handled
    if (f.parent_col !== 'id') throw new Error(`FK ${f.conname} points at ${f.parent}.${f.parent_col}: extend this script`);
    const rows = hasId
      ? await sql.unsafe(`select id from public."${f.child}" where "${f.child_col}" = any($1::uuid[])`, [vals])
      : await sql.unsafe(`select "${f.child_col}" as id from public."${f.child}" where "${f.child_col}" = any($1::uuid[])`, [vals]);
    if (!hasId && rows.length > 0) { owned[f.child] ??= new Set(); (owned[f.child].noId = true); }
    const set = (owned[f.child] ??= new Set());
    for (const r of rows) if (!set.has(r.id)) { set.add(r.id); changed = true; }
  }
}

// delete order: a table goes after every table that references it
const tables = Object.keys(owned).filter((t) => owned[t].size > 0);
const order = [];
const remaining = new Set(tables);
while (remaining.size > 0) {
  const next = [...remaining].find((t) => !fks.some((f) => f.parent === t && f.child !== t && remaining.has(f.child)));
  if (!next) throw new Error('cycle in foreign keys among: ' + [...remaining].join(', '));
  order.push(next); remaining.delete(next);
}
console.log('rows owned by the seed, in delete order:');
for (const t of order) console.log(`  ${t}: ${owned[t].size}`);

const extra = [
  ['otp_attempts', 'phone', PHONES],
];
for (const [t, col, vals] of extra) {
  const n = await sql.unsafe(`select count(*)::int c from public."${t}" where "${col}" = any($1)`, [vals]).catch(() => [{ c: '?' }]);
  console.log(`  ${t} (by phone): ${n[0].c}`);
}
if (!doDelete) { console.log('\nDry run only. Add --delete to remove these rows.'); await sql.end(); process.exit(0); }

await sql.begin(async (tx) => {
  for (const t of order) {
    const col = (await tx`select 1 from information_schema.columns where table_schema='public' and table_name=${t} and column_name='id'`).length ? 'id' : null;
    if (!col) {
      // no id column (e.g. a join table): delete by each foreign key that points at an owned parent row
      let n = 0;
      for (const f of fks.filter((x) => x.child === t && owned[x.parent]?.size)) {
        n += (await tx.unsafe(`delete from public."${t}" where "${f.child_col}" = any($1::uuid[])`, [[...owned[f.parent]]])).count;
      }
      console.log(`deleted ${n} from ${t} (by foreign key)`);
      continue;
    }
    const r = await tx.unsafe(`delete from public."${t}" where id = any($1::uuid[])`, [[...owned[t]]]);
    console.log(`deleted ${r.count} from ${t}`);
  }
  for (const [t, col, vals] of extra) await tx.unsafe(`delete from public."${t}" where "${col}" = any($1)`, [vals]).catch(() => {});
});
const left = (await sql`select phone from public.users`).filter((u) => PHONES.some((p) => u.phone.includes(p)));
console.log(`done. seed users left: ${left.length}`);
await sql.end();
