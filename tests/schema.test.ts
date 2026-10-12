import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { A, B, ID } from './helpers';

const db = new PGlite();
let serial = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
async function asUser(uid: string) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`,
  );
}
async function object(
  id: string,
  owner = A,
  metadata: object = { size: 6, mimetype: 'image/jpeg' },
) {
  await db.query('insert into storage.objects(bucket_id, name, metadata) values ($1, $2, $3)', [
    'photo-recovery',
    `${owner}/${id}.jpg`,
    JSON.stringify(metadata),
  ]);
}
async function ready(id: string, owner = A) {
  return db.query('insert into public.photo_saves(id, owner_id, state) values ($1, $2, $3)', [
    id,
    owner,
    'ready',
  ]);
}
async function remove(id: string, owner = A) {
  return db.query(
    "insert into public.photo_saves(id,owner_id,state) values ($1,$2,'deleted') on conflict(id) do update set state = 'deleted' returning *",
    [id, owner],
  );
}
before(async () => {
  // This is real PostgreSQL execution. Auth and Storage service tables are a minimal local harness.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${A}'), ('${B}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true), '')::uuid $$;
    grant usage on schema auth, storage, public to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(bucket_id text references storage.buckets(id), name text, metadata jsonb, primary key(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to authenticated;
  `);
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/20261011204618_photo_recovery.sql', import.meta.url),
      'utf8',
    ),
  );
});
after(async () => {
  await db.close();
});

test('SQL: positive control creates a ready photo with its canonical generated path', async () => {
  await asUser(A);
  await object(ID);
  await ready(ID);
  const result = await db.query<{ object_path: string }>(
    'select object_path from public.photo_saves where id=$1',
    [ID],
  );
  assert.equal(result.rows[0]?.object_path, `${A}/${ID}.jpg`);
});
test('SQL: missing, empty, oversized, and non-JPEG objects cannot confirm a row', async () => {
  await asUser(A);
  await assert.rejects(ready(nextId()), /nonempty stored JPEG/);
  for (const metadata of [
    { size: 0, mimetype: 'image/jpeg' },
    { size: 4194305, mimetype: 'image/jpeg' },
    { size: 'bad', mimetype: 'image/jpeg' },
    { size: 6, mimetype: 'text/plain' },
  ]) {
    const id = nextId();
    await object(id, A, metadata);
    await assert.rejects(ready(id), /nonempty stored JPEG/);
  }
});
test('SQL: another account cannot read the image or record', async () => {
  await asUser(B);
  assert.equal(
    (await db.query('select * from public.photo_saves where id=$1', [ID])).rows.length,
    0,
  );
  assert.equal(
    (await db.query('select * from storage.objects where name=$1', [`${A}/${ID}.jpg`])).rows.length,
    0,
  );
});
test('SQL: another account cannot insert a foreign tombstone or foreign image', async () => {
  await asUser(B);
  const id = nextId();
  await assert.rejects(remove(id, A), /row-level security/);
  await assert.rejects(object(id, A), /row-level security/);
});
test('SQL: another account cannot update or upsert an existing foreign capture', async () => {
  await asUser(B);
  assert.equal(
    (await db.query("update public.photo_saves set state='deleted' where id=$1 returning *", [ID]))
      .rows.length,
    0,
  );
  await assert.rejects(remove(ID, B), /row-level security/);
});
test('SQL: owners cannot change identity or delete the tombstone table row', async () => {
  await asUser(A);
  await assert.rejects(
    db.query('update public.photo_saves set id=$1 where id=$2', [nextId(), ID]),
    /immutable/,
  );
  await assert.rejects(
    db.query('delete from public.photo_saves where id=$1', [ID]),
    /permission denied/,
  );
});
test('SQL: storage paths must be canonical and create-only', async () => {
  await asUser(A);
  await assert.rejects(
    db.query(
      "insert into storage.objects(bucket_id,name,metadata) values ('photo-recovery',$1,'{}')",
      [`${A}/../anything.jpg`],
    ),
    /row-level security/,
  );
  await assert.rejects(object(ID), /duplicate key/);
  assert.equal(
    (
      await db.query('update storage.objects set metadata=$1 where name=$2 returning *', [
        JSON.stringify({ size: 1 }),
        `${A}/${ID}.jpg`,
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (await db.query('delete from storage.objects where name=$1 returning *', [`${A}/${ID}.jpg`]))
      .rows.length,
    0,
  );
});
test('SQL: a pre-upload tombstone blocks both a late object and a ready record', async () => {
  await asUser(A);
  const id = nextId();
  await remove(id);
  await assert.rejects(object(id), /row-level security/);
  await assert.rejects(
    db.query("update public.photo_saves set state='ready' where id=$1", [id]),
    /cannot be restored/,
  );
});
test('SQL: deletion hides existing storage metadata and cannot be undone by upsert', async () => {
  await asUser(A);
  const id = nextId();
  await object(id);
  await ready(id);
  await remove(id);
  assert.equal(
    (await db.query('select * from storage.objects where name=$1', [`${A}/${id}.jpg`])).rows.length,
    0,
  );
  await assert.rejects(
    db.query(
      "insert into public.photo_saves(id,owner_id,state) values ($1,$2,'ready') on conflict(id) do update set state='ready'",
      [id, A],
    ),
    /nonempty stored JPEG|cannot be restored/,
  );
});
test('SQL: an anonymous database role has no photo access', async () => {
  await db.exec('reset role; set role anon;');
  await assert.rejects(db.query('select * from public.photo_saves'), /permission denied/);
});
