import type { KeyValueStorage, Photo, Remote, RemoteRecord, ObjectInfo } from '../core/types';
import { writePhoto, previewPhoto, releasePreview, existingPhoto, readPhoto } from './files';
import { verifyImageUri } from './image';

export const DEMO_A = '11111111-1111-4111-8111-111111111111';
export const DEMO_B = '22222222-2222-4222-8222-222222222222';
type DemoObject = ObjectInfo & { uri: string };
const prefix = 'photo-recovery:demo-cloud:';
export class DemoCloud {
  private tails = new Map<string, Promise<unknown>>();
  constructor(private readonly storage: KeyValueStorage) {}
  private async serialized<T>(path: string, work: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(path) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(work);
    this.tails.set(path, next);
    try {
      return await next;
    } finally {
      if (this.tails.get(path) === next) this.tails.delete(path);
    }
  }
  private async read<T>(key: string): Promise<T | null> {
    const raw = await this.storage.getItem(prefix + key);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  private async write(key: string, data: unknown) {
    await this.storage.setItem(prefix + key, JSON.stringify(data));
  }
  async counts(owner: string) {
    const keys = (await this.storage.getAllKeys()).filter(
      (k) => k.startsWith(prefix) && k.includes(owner),
    );
    let objects = 0,
      rows = 0,
      deleted = 0;
    for (const key of keys) {
      if (key.includes(':object:')) objects++;
      else {
        const row = JSON.parse((await this.storage.getItem(key))!);
        if (row.state === 'ready') rows++;
        else deleted++;
      }
    }
    return { objects, rows, deleted };
  }
  forOwner(owner: string): Remote {
    const check = (p: Photo) => {
      if (p.ownerId !== owner) throw new Error('Account mismatch.');
    };
    const readRow = async (p: Photo) => {
      check(p);
      return this.read<RemoteRecord>(`row:${p.objectPath}`);
    };
    const readObject = async (p: Photo) => {
      check(p);
      if ((await readRow(p))?.state === 'deleted') throw new Error('Photo removed.');
      const stored = await this.read<DemoObject>(`object:${p.objectPath}`);
      if (stored) return stored;
      // A reload between the file write and its demo index write must still find the file.
      const uri = await existingPhoto(`cloud-${owner}-${p.id}`);
      if (!uri) return null;
      const object = {
        uri,
        byteLength: (await readPhoto(uri)).byteLength,
        contentType: 'image/jpeg',
      };
      await this.write(`object:${p.objectPath}`, object);
      return object;
    };
    return {
      readRecord: readRow,
      inspectObject: readObject,
      upload: async (p, bytes) => {
        check(p);
        if (await readObject(p)) throw new Error('Object already exists.');
        const uri = await writePhoto(`cloud-${owner}-${p.id}`, bytes);
        await this.write(`object:${p.objectPath}`, {
          uri,
          byteLength: bytes.byteLength,
          contentType: 'image/jpeg',
        });
      },
      verifyImage: async (p) => {
        const object = await readObject(p);
        if (!object) throw new Error('Object missing.');
        const uri = await previewPhoto(object.uri);
        try {
          await verifyImageUri(uri);
        } finally {
          releasePreview(uri);
        }
      },
      insertRecord: (p) =>
        this.serialized(p.objectPath, async () => {
          check(p);
          if (await readRow(p)) throw new Error('Record already exists.');
          if (!(await readObject(p))) throw new Error('Object missing.');
          const row: RemoteRecord = {
            id: p.id,
            ownerId: owner,
            objectPath: p.objectPath,
            state: 'ready',
          };
          await this.write(`row:${p.objectPath}`, row);
          return row;
        }),
      markDeleted: (p) =>
        this.serialized(p.objectPath, async () => {
          check(p);
          const row: RemoteRecord = {
            id: p.id,
            ownerId: owner,
            objectPath: p.objectPath,
            state: 'deleted',
          };
          await this.write(`row:${p.objectPath}`, row);
          return row;
        }),
    };
  }
}
