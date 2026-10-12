import { PhotoJournal } from './journal';
import {
  isUuid,
  MAX_PHOTO_BYTES,
  objectPath,
  RecoveryError,
  type LocalFiles,
  type ObjectInfo,
  type Photo,
  type Remote,
  type RemoteRecord,
  type Trace,
} from './types';

type Scope = Readonly<{ ownerId: string; generation: number }>;
type Options = {
  journal: PhotoJournal;
  files: LocalFiles;
  remote: (ownerId: string) => Promise<Remote>;
  createId: () => string;
  onTrace?: (event: Trace) => void;
  now?: () => number;
};

/** Framework-independent recovery. Never persist credentials or signed URLs in the journal. */
export class PhotoRecovery {
  private generation = 0;
  private scope: Scope | null = null;
  private tails = new Map<string, Promise<unknown>>();
  private listeners = new Set<() => void>();
  private deleting = new Set<string>();
  constructor(private readonly options: Options) {}
  setAccount(ownerId: string | null): void {
    if (ownerId !== null && !isUuid(ownerId))
      throw new RecoveryError('corrupt', 'Invalid account identity.');
    this.scope = ownerId ? Object.freeze({ ownerId, generation: ++this.generation }) : null;
    if (!ownerId) this.generation++;
    this.changed();
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed() {
    this.listeners.forEach((fn) => fn());
  }
  private captureScope(): Scope {
    if (!this.scope) throw new RecoveryError('stale', 'Sign in before saving a photo.');
    return this.scope;
  }
  private check(scope: Scope) {
    if (this.scope !== scope)
      throw new RecoveryError('stale', 'The account changed. The old operation was stopped.');
  }
  private event(p: Photo, stage: string, outcome: Trace['outcome']) {
    this.options.onTrace?.({ at: (this.options.now ?? Date.now)(), photoId: p.id, stage, outcome });
  }
  async list(): Promise<Photo[]> {
    const scope = this.scope;
    if (!scope) return [];
    const rows = await this.options.journal.list(scope.ownerId);
    this.check(scope);
    return rows;
  }
  async capture(
    localUri: string,
    byteLength: number,
    id = this.options.createId(),
  ): Promise<Photo> {
    const scope = this.captureScope();
    const photo: Photo = {
      version: 1,
      id,
      ownerId: scope.ownerId,
      localUri,
      byteLength,
      objectPath: objectPath(scope.ownerId, id),
      createdAt: (this.options.now ?? Date.now)(),
      state: 'local',
      deleteConfirmed: false,
    };
    if (byteLength < 1 || byteLength > MAX_PHOTO_BYTES)
      throw new RecoveryError('missing-file', 'Choose a nonempty JPEG smaller than 4 MB.');
    await this.options.journal.put(photo);
    this.check(scope);
    this.changed();
    return photo;
  }
  save(id: string): Promise<Photo> {
    const scope = this.captureScope(),
      key = objectPath(scope.ownerId, id);
    const prior = this.tails.get(key) ?? Promise.resolve();
    const work = prior.catch(() => undefined).then(() => this.saveCurrent(scope, id));
    this.tails.set(key, work);
    return work.finally(() => {
      if (this.tails.get(key) === work) this.tails.delete(key);
    });
  }
  private recordMatches(photo: Photo, record: RemoteRecord): void {
    if (
      record.id !== photo.id ||
      record.ownerId !== photo.ownerId ||
      record.objectPath !== photo.objectPath ||
      !['ready', 'deleted'].includes(record.state)
    ) {
      throw new RecoveryError('corrupt', 'The cloud record does not belong to this capture.');
    }
  }
  private objectMatches(photo: Photo, info: ObjectInfo) {
    if (info.byteLength !== photo.byteLength || info.contentType !== 'image/jpeg') {
      throw new RecoveryError(
        'corrupt',
        'The stored image is empty or differs from the original. It was not overwritten.',
      );
    }
  }
  private async saveCurrent(scope: Scope, id: string): Promise<Photo> {
    this.check(scope);
    let p = await this.options.journal.get(scope.ownerId, id);
    this.check(scope);
    if (!p) throw new RecoveryError('missing-file', 'The local photo was not found.');
    const photo = p;
    const check = () => {
      this.check(scope);
      if (this.deleting.has(photo.objectPath) || photo.state === 'deleted')
        throw new RecoveryError('deleted', 'This photo was removed.');
    };
    check();
    let stage = 'Read cloud record';
    try {
      if (p.state !== 'confirmed') {
        p = await this.options.journal.put({ ...p, state: 'pending', lastError: undefined });
        check();
        this.changed();
      }
      const remote = await this.options.remote(scope.ownerId);
      check();
      this.event(p, stage, 'working');
      let row = await remote.readRecord(p);
      check();
      if (row) {
        this.recordMatches(p, row);
        if (row.state === 'deleted') {
          await this.options.journal.put({
            ...p,
            state: 'deleted',
            deleteConfirmed: true,
            lastError: undefined,
          });
          throw new RecoveryError(
            'deleted',
            'The cloud removal is permanent. A retry cannot recreate this photo.',
          );
        }
      } else if (p.state === 'confirmed') {
        throw new RecoveryError(
          'unconfirmed',
          'The previously confirmed cloud record is missing. It was not recreated.',
        );
      }
      this.event(p, stage, 'ok');
      stage = 'Check stored image';
      this.event(p, stage, 'working');
      let object = await remote.inspectObject(p);
      check();
      if (object) this.objectMatches(p, object);
      else {
        if (p.state === 'confirmed' || row)
          throw new RecoveryError(
            'unconfirmed',
            'The confirmed image is missing. It was not recreated.',
          );
        let bytes: Uint8Array;
        try {
          bytes = await this.options.files.read(p.localUri);
        } catch {
          check();
          throw new RecoveryError(
            'missing-file',
            'The original JPEG is missing or cannot be read. No replacement was uploaded.',
          );
        }
        check();
        if (bytes.byteLength !== p.byteLength || bytes[0] !== 0xff || bytes[1] !== 0xd8)
          throw new RecoveryError(
            'missing-file',
            'The original JPEG is missing, empty, or damaged.',
          );
        stage = 'Upload image';
        this.event(p, stage, 'working');
        let uploadError: unknown;
        try {
          await remote.upload(p, bytes);
        } catch (error) {
          uploadError = error;
        }
        check();
        // Lost acknowledgements and conflicts are ambiguous. Read the exact object before retrying.
        object = await remote.inspectObject(p);
        check();
        if (!object)
          throw (
            uploadError ?? new RecoveryError('unconfirmed', 'The upload could not be confirmed.')
          );
        this.objectMatches(p, object);
      }
      this.event(p, stage, 'ok');
      stage = 'Verify readable image';
      this.event(p, stage, 'working');
      await remote.verifyImage(p);
      check();
      this.event(p, stage, 'ok');
      stage = 'Save database record';
      this.event(p, stage, 'working');
      if (!row) {
        let insertError: unknown;
        try {
          row = await remote.insertRecord(p);
        } catch (error) {
          insertError = error;
        }
        check();
        if (!row) {
          row = await remote.readRecord(p);
          check();
        }
        if (!row)
          throw (
            insertError ??
            new RecoveryError('unconfirmed', 'The database save could not be confirmed.')
          );
      }
      this.recordMatches(p, row);
      if (row.state === 'deleted') {
        await this.options.journal.put({ ...p, state: 'deleted', deleteConfirmed: true });
        throw new RecoveryError('deleted', 'The photo was removed while saving.');
      }
      this.event(p, stage, 'ok');
      check();
      const confirmed = await this.options.journal.put({
        ...p,
        state: 'confirmed',
        lastError: undefined,
      });
      check();
      this.changed();
      return confirmed;
    } catch (error) {
      if (error instanceof RecoveryError && (error.code === 'stale' || error.code === 'deleted')) {
        this.changed();
        throw error;
      }
      check();
      this.event(p, stage, 'unconfirmed');
      const message =
        error instanceof RecoveryError
          ? error.message
          : 'Cloud save is unconfirmed. Your original photo is still on this device.';
      await this.options.journal.put({ ...p, lastError: message });
      check();
      this.changed();
      throw error instanceof RecoveryError ? error : new RecoveryError('unconfirmed', message);
    }
  }
  async remove(id: string): Promise<Photo> {
    const scope = this.captureScope(),
      path = objectPath(scope.ownerId, id);
    // Fence a held upload immediately; deletion must not wait behind a slow transfer.
    this.deleting.add(path);
    let p = await this.options.journal.get(scope.ownerId, id);
    this.check(scope);
    if (!p) throw new RecoveryError('missing-file', 'Photo not found.');
    p = await this.options.journal.put({ ...p, state: 'deleted', lastError: undefined });
    this.check(scope);
    this.changed();
    try {
      const remote = await this.options.remote(scope.ownerId);
      this.check(scope);
      const row = await remote.markDeleted(p);
      this.check(scope);
      this.recordMatches(p, row);
      if (row.state !== 'deleted')
        throw new RecoveryError('unconfirmed', 'Cloud removal is unconfirmed.');
      p = await this.options.journal.put({ ...p, deleteConfirmed: true });
      this.check(scope);
      this.changed();
      return p;
    } catch (error) {
      this.check(scope);
      await this.options.journal.put({
        ...p,
        lastError: 'Removed locally. Reconnect and retry to confirm cloud removal.',
      });
      this.check(scope);
      this.changed();
      throw error;
    }
  }
}
