import { PhotoJournal } from '../src/core/journal';
import { PhotoRecovery } from '../src/core/recovery';
import { Faults } from '../src/adapters/faults';
import {
  RecoveryError,
  type KeyValueStorage,
  type ObjectInfo,
  type Photo,
  type Remote,
  type RemoteRecord,
} from '../src/core/types';

export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
export class MemoryStorage implements KeyValueStorage {
  items = new Map<string, string>();
  fail = false;
  async getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    if (this.fail) throw new Error('Disk full');
    this.items.set(k, v);
  }
  async getAllKeys() {
    return [...this.items.keys()];
  }
}
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
export class MemoryRemote implements Remote {
  objects = new Map<string, ObjectInfo>();
  rows = new Map<string, RemoteRecord>();
  uploads = 0;
  inserts = 0;
  deletes = 0;
  reads = 0;
  readable = true;
  async readRecord(p: Photo) {
    this.reads++;
    return this.rows.get(p.objectPath) ?? null;
  }
  async inspectObject(p: Photo) {
    return this.objects.get(p.objectPath) ?? null;
  }
  async upload(p: Photo, bytes: Uint8Array) {
    this.uploads++;
    if (this.objects.has(p.objectPath)) throw new Error('Already exists');
    if (this.rows.get(p.objectPath)?.state === 'deleted') throw new Error('Tombstone');
    this.objects.set(p.objectPath, { byteLength: bytes.byteLength, contentType: 'image/jpeg' });
  }
  async verifyImage() {
    if (!this.readable) throw new Error('Image decode failed');
  }
  async insertRecord(p: Photo) {
    this.inserts++;
    if (this.rows.has(p.objectPath)) throw new Error('Record already exists');
    if (!this.objects.has(p.objectPath)) throw new Error('No object');
    const row: RemoteRecord = {
      id: p.id,
      ownerId: p.ownerId,
      objectPath: p.objectPath,
      state: 'ready',
    };
    this.rows.set(p.objectPath, row);
    return row;
  }
  async markDeleted(p: Photo) {
    this.deletes++;
    const row: RemoteRecord = {
      id: p.id,
      ownerId: p.ownerId,
      objectPath: p.objectPath,
      state: 'deleted',
    };
    this.rows.set(p.objectPath, row);
    return row;
  }
}
export function fixture() {
  const storage = new MemoryStorage(),
    journal = new PhotoJournal(storage),
    remote = new MemoryRemote(),
    faults = new Faults();
  const files = new Map<string, Uint8Array>([['local://photo', JPEG]]);
  const options = {
    journal,
    files: {
      read: async (uri: string) => {
        const data = files.get(uri);
        if (!data) throw new RecoveryError('missing-file', 'Original missing');
        return data;
      },
    },
    remote: async () => faults.wrap(remote),
    createId: () => ID,
    now: () => 100,
  };
  const recovery = new PhotoRecovery(options);
  recovery.setAccount(A);
  const restart = () => {
    const next = new PhotoRecovery(options);
    next.setAccount(A);
    return next;
  };
  return {
    storage,
    journal,
    remote,
    faults,
    files,
    options,
    recovery,
    restart,
    capture: () => recovery.capture('local://photo', JPEG.byteLength),
  };
}
