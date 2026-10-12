import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { PhotoJournal } from '../src/core/journal';
import { PhotoRecovery } from '../src/core/recovery';
import { Faults } from '../src/adapters/faults';
import { supabaseRemote } from '../src/adapters/supabase';
import { MemoryStorage } from '../tests/helpers';
import { BUCKET } from '../src/core/types';

// Local-only integration tests: never point this script at a hosted or product project.
const status = JSON.parse(await readFile('output/local-supabase.json', 'utf8'));
const url = status.API_URL as string,
  key = status.ANON_KEY as string;
if (!/^http:\/\/(127\.0\.0\.1|localhost):54621$/.test(url))
  throw new Error(
    "Integration tests require this starter's separate local Supabase stack on port 54621.",
  );
const clients = [0, 1].map(() =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
);
const sessions = await Promise.all(
  clients.map(async (c) => {
    const { data, error } = await c.auth.signInAnonymously();
    if (error) throw error;
    return data.session!;
  }),
);
const a = sessions[0]!,
  b = sessions[1]!,
  client = clients[0]!;
const jpeg = new Uint8Array(await readFile('assets/sample.jpg'));
let passed = 0;
const check = async (name: string, work: () => Promise<void>) => {
  await work();
  passed++;
  console.log(`PASS ${name}`);
};
const verify = async (uri: string) => {
  const response = await fetch(uri);
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(bytes, jpeg);
};
function setup() {
  const storage = new MemoryStorage(),
    journal = new PhotoJournal(storage),
    faults = new Faults();
  const remote = supabaseRemote(url, key, a.user.id, a.access_token, verify);
  const options = {
    journal,
    files: { read: async () => jpeg },
    remote: async () => faults.wrap(remote),
    createId: randomUUID,
  };
  const controller = () => {
    const r = new PhotoRecovery(options);
    r.setAccount(a.user.id);
    return r;
  };
  return { remote, faults, journal, controller, recovery: controller() };
}
for (const scenario of [
  'normal',
  'upload-rejected',
  'upload-response-lost',
  'row-rejected',
  'row-response-lost',
  'offline',
] as const) {
  await check(`real Storage + database: ${scenario}, restart, retry, and repeat`, async () => {
    const f = setup(),
      p = await f.recovery.capture('fixture://sample', jpeg.byteLength);
    f.faults.select(scenario);
    if (scenario === 'normal') await f.recovery.save(p.id);
    else await assert.rejects(f.recovery.save(p.id));
    f.faults.reconnect();
    await f.controller().save(p.id);
    await f.controller().save(p.id);
    const { data: objects, error: objectError } = await client.storage
      .from(BUCKET)
      .list(a.user.id, { search: `${p.id}.jpg` });
    if (objectError) throw objectError;
    assert.equal(objects.length, 1);
    const { data: rows, error: rowError } = await client
      .from('photo_saves')
      .select('*')
      .eq('id', p.id);
    if (rowError) throw rowError;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, 'ready');
    assert.equal((await f.journal.get(a.user.id, p.id))?.state, 'confirmed');
  });
}
await check('real RLS: other account cannot read, replace, or remove another capture', async () => {
  const f = setup(),
    p = await f.recovery.capture('fixture://sample', jpeg.byteLength);
  await f.recovery.save(p.id);
  const other = supabaseRemote(url, key, b.user.id, b.access_token, verify);
  const { data, error } = await clients[1]!.from('photo_saves').select('*').eq('id', p.id);
  if (error) throw error;
  assert.equal(data.length, 0);
  const { error: foreignUpload } = await clients[1]!.storage
    .from(BUCKET)
    .upload(p.objectPath, jpeg.buffer, { contentType: 'image/jpeg' });
  assert.ok(foreignUpload);
  await assert.rejects(other.markDeleted({ ...p, ownerId: b.user.id }));
  const { data: signed, error: privateError } = await clients[1]!.storage
    .from(BUCKET)
    .createSignedUrl(p.objectPath, 60);
  assert.ok(privateError);
  assert.equal(signed, null);
});
await check('real RLS: tombstone blocks later upload, insert, and new signed URLs', async () => {
  const f = setup(),
    p = await f.recovery.capture('fixture://sample', jpeg.byteLength);
  await f.recovery.remove(p.id);
  await assert.rejects(f.remote.upload(p, jpeg));
  await assert.rejects(f.remote.insertRecord(p));
  await assert.rejects(f.controller().save(p.id));
  const g = setup(),
    q = await g.recovery.capture('fixture://sample', jpeg.byteLength);
  await g.recovery.save(q.id);
  await g.recovery.remove(q.id);
  await assert.rejects(g.remote.verifyImage(q));
});
await check('real database rejects confirmation for a missing storage object', async () => {
  const { error } = await client
    .from('photo_saves')
    .insert({ id: randomUUID(), owner_id: a.user.id, state: 'ready' });
  assert.ok(error);
  assert.match(error.message, /nonempty stored JPEG/);
});
console.log(
  `${passed}/${passed} local Supabase integration scenarios passed. HTTP downloads matched the synthetic JPEG byte-for-byte. Native image decoding is a separate check.`,
);
