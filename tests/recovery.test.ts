import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhotoRecovery } from '../src/core/recovery';
import { PhotoJournal } from '../src/core/journal';
import { withDeadline } from '../src/core/deadline';
import { A, B, ID, JPEG, deferred, fixture } from './helpers';

test('normal save, repeated retry, and concurrent taps create one object and one row', async () => {
  const f = fixture();
  await f.capture();
  const results = await Promise.all([
    f.recovery.save(ID),
    f.recovery.save(ID),
    f.recovery.save(ID),
  ]);
  assert.ok(results.every((p) => p.state === 'confirmed'));
  assert.equal(f.remote.uploads, 1);
  assert.equal(f.remote.inserts, 1);
  assert.equal(f.remote.objects.size, 1);
  assert.equal(f.remote.rows.size, 1);
});

test('durable intent exists before first remote access', async () => {
  const f = fixture();
  await f.capture();
  const r = new PhotoRecovery({
    ...f.options,
    remote: async () => {
      assert.equal((await f.journal.get(A, ID))?.state, 'pending');
      return f.remote;
    },
  });
  r.setAccount(A);
  await r.save(ID);
});

test('journal write failure prevents all remote effects', async () => {
  const f = fixture();
  await f.capture();
  f.storage.fail = true;
  await assert.rejects(f.recovery.save(ID));
  assert.equal(f.remote.reads, 0);
  assert.equal(f.remote.uploads, 0);
});

for (const scenario of [
  'upload-rejected',
  'upload-response-lost',
  'row-rejected',
  'row-response-lost',
  'offline',
] as const) {
  test(`${scenario}: pending survives controller restart; retry reuses capture identity`, async () => {
    const f = fixture();
    const original = await f.capture();
    f.faults.select(scenario);
    await assert.rejects(f.recovery.save(ID));
    assert.equal((await f.journal.get(A, ID))?.state, 'pending');
    const objectsBefore = f.remote.objects.size,
      rowsBefore = f.remote.rows.size;
    if (scenario === 'upload-response-lost' || scenario.startsWith('row-'))
      assert.equal(objectsBefore, 1);
    if (scenario === 'row-response-lost') assert.equal(rowsBefore, 1);
    f.faults.reconnect();
    const restored = f.restart();
    const saved = await restored.save(ID);
    assert.equal(saved.id, original.id);
    assert.equal(saved.objectPath, original.objectPath);
    assert.equal(saved.state, 'confirmed');
    assert.equal(f.remote.objects.size, 1);
    assert.equal(f.remote.rows.size, 1);
    assert.equal(f.remote.uploads, 1);
    assert.equal(f.remote.inserts, 1);
  });
}

test('a lost acknowledgement with immediately available reads confirms without a retry', async () => {
  const f = fixture();
  await f.capture();
  const upload = f.remote.upload.bind(f.remote);
  f.remote.upload = async (p, bytes) => {
    await upload(p, bytes);
    throw new Error('Lost response');
  };
  assert.equal((await f.recovery.save(ID)).state, 'confirmed');
  assert.equal(f.remote.uploads, 1);
});

test('permission errors are not treated as an absent database row', async () => {
  const f = fixture();
  await f.capture();
  f.remote.readRecord = async () => {
    throw new Error('Permission denied');
  };
  await assert.rejects(f.recovery.save(ID));
  assert.equal(f.remote.uploads, 0);
  assert.equal(f.remote.inserts, 0);
});

test('corrupted journal and changed path fail before cloud writes', async () => {
  const f = fixture();
  const p = await f.capture();
  const key = [...f.storage.items.keys()][0]!;
  f.storage.items.set(key, JSON.stringify({ ...p, objectPath: `${B}/${ID}.jpg` }));
  await assert.rejects(f.recovery.save(ID), /damaged/);
  assert.equal(f.remote.reads, 0);
  f.storage.items.set(key, '{broken');
  await assert.rejects(f.restart().list(), /damaged/);
});

test('capture identity cannot be repointed or reused to replace a photo', async () => {
  const f = fixture();
  const p = await f.capture();
  await assert.rejects(f.journal.put({ ...p, localUri: 'other://photo' }), /identity/);
});

for (const kind of ['missing', 'empty', 'wrong-format'] as const) {
  test(`${kind} local file never produces a cloud confirmation`, async () => {
    const f = fixture();
    await f.capture();
    if (kind === 'missing') f.files.clear();
    else
      f.files.set(
        'local://photo',
        kind === 'empty' ? new Uint8Array() : new Uint8Array(JPEG.byteLength),
      );
    await assert.rejects(f.recovery.save(ID));
    assert.equal(f.remote.uploads, 0);
    assert.equal(f.remote.inserts, 0);
  });
}

for (const info of [
  { byteLength: 0, contentType: 'image/jpeg' },
  { byteLength: 99, contentType: 'image/jpeg' },
  { byteLength: JPEG.byteLength, contentType: 'text/plain' },
]) {
  test(`invalid existing object ${JSON.stringify(info)} is never overwritten`, async () => {
    const f = fixture();
    const p = await f.capture();
    f.remote.objects.set(p.objectPath, info);
    await assert.rejects(f.recovery.save(ID), /stored image/);
    assert.equal(f.remote.uploads, 0);
    assert.equal(f.remote.inserts, 0);
  });
}

test('an undecodable image is not marked confirmed or inserted', async () => {
  const f = fixture();
  await f.capture();
  f.remote.readable = false;
  await assert.rejects(f.recovery.save(ID));
  assert.equal(f.remote.objects.size, 1);
  assert.equal(f.remote.inserts, 0);
});

test('a valid already-uploaded photo can finish even if the local file is missing', async () => {
  const f = fixture();
  const p = await f.capture();
  await f.remote.upload(p, JPEG);
  f.files.clear();
  assert.equal((await f.recovery.save(ID)).state, 'confirmed');
  assert.equal(f.remote.uploads, 1);
});

test('local disk failure after cloud commit recovers without duplicated writes', async () => {
  const f = fixture();
  await f.capture();
  const insert = f.remote.insertRecord.bind(f.remote);
  f.remote.insertRecord = async (p) => {
    const row = await insert(p);
    f.storage.fail = true;
    return row;
  };
  await assert.rejects(f.recovery.save(ID));
  f.storage.fail = false;
  assert.equal((await f.restart().save(ID)).state, 'confirmed');
  assert.equal(f.remote.inserts, 1);
});

for (const stage of ['remote', 'read', 'inspect', 'file', 'upload', 'verify', 'insert'] as const) {
  test(`account changes at ${stage} fence all subsequent effects and local confirmation`, async () => {
    const f = fixture();
    await f.capture();
    let r!: PhotoRecovery;
    const swap = () => r.setAccount(B);
    let options = f.options;
    if (stage === 'remote')
      options = {
        ...options,
        remote: async () => {
          swap();
          return f.remote;
        },
      };
    if (stage === 'file')
      options = {
        ...options,
        files: {
          read: async () => {
            swap();
            return JPEG;
          },
        },
      };
    if (stage === 'read') {
      const fn = f.remote.readRecord.bind(f.remote);
      f.remote.readRecord = async (p) => {
        const v = await fn(p);
        swap();
        return v;
      };
    }
    if (stage === 'inspect') {
      const fn = f.remote.inspectObject.bind(f.remote);
      f.remote.inspectObject = async (p) => {
        const v = await fn(p);
        swap();
        return v;
      };
    }
    if (stage === 'upload') {
      const fn = f.remote.upload.bind(f.remote);
      f.remote.upload = async (p, b) => {
        await fn(p, b);
        swap();
      };
    }
    if (stage === 'verify')
      f.remote.verifyImage = async () => {
        swap();
      };
    if (stage === 'insert') {
      const fn = f.remote.insertRecord.bind(f.remote);
      f.remote.insertRecord = async (p) => {
        const v = await fn(p);
        swap();
        return v;
      };
    }
    r = new PhotoRecovery(options);
    r.setAccount(A);
    await assert.rejects(r.save(ID), /account changed/);
    assert.equal((await f.journal.get(A, ID))?.state, 'pending');
    assert.deepEqual(await r.list(), []);
    assert.equal(f.remote.inserts, stage === 'insert' ? 1 : 0);
    if (['remote', 'read', 'inspect', 'file'].includes(stage)) assert.equal(f.remote.uploads, 0);
  });
}

test('A to B to A does not revive an old operation', async () => {
  const f = fixture();
  await f.capture();
  const held = deferred(),
    entered = deferred();
  f.remote.readRecord = async () => {
    entered.resolve();
    await held.promise;
    return null;
  };
  const saving = f.recovery.save(ID);
  await entered.promise;
  f.recovery.setAccount(B);
  f.recovery.setAccount(A);
  held.resolve();
  await assert.rejects(saving, /account changed/);
  assert.equal(f.remote.uploads, 0);
});

test('removal fences a held upload and survives restart; retry never resurrects it', async () => {
  const f = fixture();
  await f.capture();
  const held = deferred(),
    entered = deferred();
  const upload = f.remote.upload.bind(f.remote);
  f.remote.upload = async (p, b) => {
    entered.resolve();
    await held.promise;
    await upload(p, b);
  };
  const saving = f.recovery.save(ID);
  await entered.promise;
  const deleted = await f.recovery.remove(ID);
  assert.equal(deleted.deleteConfirmed, true);
  held.resolve();
  await assert.rejects(saving, /removed/);
  assert.equal((await f.journal.get(A, ID))?.state, 'deleted');
  assert.equal(f.remote.inserts, 0);
  await assert.rejects(f.restart().save(ID), /removed/);
});

test('offline removal remains deleted and can later confirm its tombstone', async () => {
  const f = fixture();
  await f.capture();
  f.faults.select('offline');
  await assert.rejects(f.recovery.remove(ID));
  const p = await f.journal.get(A, ID);
  assert.equal(p?.state, 'deleted');
  assert.equal(p?.deleteConfirmed, false);
  f.faults.reconnect();
  const restored = f.restart();
  assert.equal((await restored.remove(ID)).deleteConfirmed, true);
  await assert.rejects(restored.save(ID), /removed/);
});

test('a remote tombstone is adopted locally without an upload', async () => {
  const f = fixture();
  const p = await f.capture();
  await f.remote.markDeleted(p);
  await assert.rejects(f.recovery.save(ID), /removal/);
  assert.equal((await f.journal.get(A, ID))?.state, 'deleted');
  assert.equal(f.remote.uploads, 0);
});

for (const missing of ['record', 'object'] as const) {
  test(`a previously confirmed ${missing} that disappears is never recreated`, async () => {
    const f = fixture();
    await f.capture();
    await f.recovery.save(ID);
    if (missing === 'record') f.remote.rows.clear();
    else f.remote.objects.clear();
    await assert.rejects(f.restart().save(ID), /not recreated/);
    assert.equal(f.remote.uploads, 1);
    assert.equal(f.remote.inserts, 1);
  });
}

test('serialized journal writes keep a tombstone permanent', async () => {
  const f = fixture();
  const p = await f.capture();
  const journal = new PhotoJournal(f.storage);
  await journal.put({ ...p, state: 'deleted', deleteConfirmed: true });
  await assert.rejects(journal.put({ ...p, state: 'confirmed' }), /removed/);
  assert.equal(
    (await journal.put({ ...p, state: 'deleted', deleteConfirmed: false })).deleteConfirmed,
    true,
  );
});

test('journal contains only local recovery information, with no credentials or signed URLs', async () => {
  const f = fixture();
  await f.capture();
  await f.recovery.save(ID);
  assert.doesNotMatch(
    [...f.storage.items.values()].join(''),
    /access_token|refresh_token|signedURL|Authorization/,
  );
});

test('a held request times out, releases the save queue, and later retry reconciles its late commit', async () => {
  const f = fixture();
  const p = await f.capture();
  const held = deferred(),
    entered = deferred(),
    committed = deferred();
  const upload = f.remote.upload.bind(f.remote);
  f.remote.upload = async (photo, bytes) => {
    entered.resolve();
    await held.promise;
    await upload(photo, bytes);
    committed.resolve();
  };
  const options = { ...f.options, remote: async () => withDeadline(f.faults.wrap(f.remote), 20) };
  const r = new PhotoRecovery(options);
  r.setAccount(A);
  const saving = r.save(ID);
  await entered.promise;
  f.faults.select('offline');
  await assert.rejects(saving);
  assert.equal((await f.journal.get(A, ID))?.state, 'pending');
  held.resolve();
  await committed.promise;
  assert.ok(f.remote.objects.has(p.objectPath));
  f.faults.reconnect();
  assert.equal((await r.save(ID)).state, 'confirmed');
  assert.equal(f.remote.uploads, 1);
});

test('a save accepted before removal can finish late without restoring a ready record', async () => {
  const f = fixture();
  const p = await f.capture();
  const held = deferred(),
    entered = deferred();
  f.remote.upload = async (_photo, bytes) => {
    f.remote.uploads++;
    entered.resolve();
    await held.promise;
    f.remote.objects.set(p.objectPath, { byteLength: bytes.byteLength, contentType: 'image/jpeg' });
  };
  const saving = f.recovery.save(ID);
  await entered.promise;
  await f.recovery.remove(ID);
  held.resolve();
  await assert.rejects(saving, /removed/);
  assert.equal(f.remote.objects.size, 1);
  assert.equal(f.remote.rows.get(p.objectPath)?.state, 'deleted');
  assert.equal(f.remote.inserts, 0);
  assert.equal((await f.journal.get(A, ID))?.state, 'deleted');
});

test('unrecognized JSON fields never enter a rewritten journal entry', async () => {
  const f = fixture();
  const p = await f.capture(),
    key = [...f.storage.items.keys()][0]!;
  f.storage.items.set(key, JSON.stringify({ ...p, access_token: 'must-not-propagate' }));
  await f.recovery.save(ID);
  assert.doesNotMatch(f.storage.items.get(key)!, /access_token|must-not-propagate/);
});
