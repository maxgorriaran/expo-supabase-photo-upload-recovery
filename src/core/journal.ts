import {
  isUuid,
  MAX_PHOTO_BYTES,
  objectPath,
  RecoveryError,
  type KeyValueStorage,
  type Photo,
} from './types';

const PREFIX = 'photo-recovery:v1:';
export function validatePhoto(value: unknown): Photo {
  const p = value as Photo | null;
  if (
    !p ||
    p.version !== 1 ||
    !isUuid(p.id) ||
    !isUuid(p.ownerId) ||
    typeof p.localUri !== 'string' ||
    !p.localUri ||
    p.objectPath !== objectPath(p.ownerId, p.id) ||
    !Number.isSafeInteger(p.byteLength) ||
    p.byteLength < 1 ||
    p.byteLength > MAX_PHOTO_BYTES ||
    !Number.isSafeInteger(p.createdAt) ||
    p.createdAt < 0 ||
    !['local', 'pending', 'confirmed', 'deleted'].includes(p.state) ||
    typeof p.deleteConfirmed !== 'boolean' ||
    (p.lastError !== undefined && typeof p.lastError !== 'string')
  ) {
    throw new RecoveryError(
      'corrupt',
      'The local recovery record is damaged. No cloud write was attempted.',
    );
  }
  // Whitelist fields; unexpected values in stored JSON must not become telemetry or credentials.
  return {
    version: 1,
    id: p.id,
    ownerId: p.ownerId,
    localUri: p.localUri,
    objectPath: p.objectPath,
    byteLength: p.byteLength,
    createdAt: p.createdAt,
    state: p.state,
    deleteConfirmed: p.deleteConfirmed,
    ...(p.lastError === undefined ? {} : { lastError: p.lastError }),
  };
}

/** One immutable ID per capture. Writes serialize per ID; a deletion is irreversible. */
export class PhotoJournal {
  private tails = new Map<string, Promise<unknown>>();
  constructor(private readonly storage: KeyValueStorage) {}
  private key(ownerId: string, id: string) {
    return `${PREFIX}${ownerId}:${id}`;
  }
  async get(ownerId: string, id: string): Promise<Photo | null> {
    if (!isUuid(ownerId) || !isUuid(id))
      throw new RecoveryError('corrupt', 'Invalid photo identity.');
    const raw = await this.storage.getItem(this.key(ownerId, id));
    if (raw === null) return null;
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new RecoveryError('corrupt', 'The local recovery record is damaged.');
    }
    const p = validatePhoto(decoded);
    if (p.ownerId !== ownerId || p.id !== id)
      throw new RecoveryError('corrupt', 'The local photo owner changed.');
    return p;
  }
  async list(ownerId: string): Promise<Photo[]> {
    if (!isUuid(ownerId)) throw new RecoveryError('corrupt', 'Invalid account identity.');
    const keys = (await this.storage.getAllKeys()).filter((k) =>
      k.startsWith(`${PREFIX}${ownerId}:`),
    );
    const rows = await Promise.all(
      keys.map((key) => this.get(ownerId, key.slice(`${PREFIX}${ownerId}:`.length))),
    );
    return rows.filter((p): p is Photo => p !== null).sort((a, b) => b.createdAt - a.createdAt);
  }
  async put(input: Photo): Promise<Photo> {
    const p = validatePhoto(input),
      key = this.key(p.ownerId, p.id);
    const prior = this.tails.get(key) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(async () => {
        const old = await this.get(p.ownerId, p.id);
        if (
          old &&
          (old.objectPath !== p.objectPath ||
            old.localUri !== p.localUri ||
            old.byteLength !== p.byteLength ||
            old.createdAt !== p.createdAt)
        ) {
          throw new RecoveryError(
            'corrupt',
            'A retry cannot replace the original capture identity.',
          );
        }
        if (old?.state === 'deleted' && p.state !== 'deleted')
          throw new RecoveryError('deleted', 'This photo was removed.');
        // An older deletion acknowledgement cannot erase a newer confirmed tombstone.
        const stored = old?.deleteConfirmed ? { ...p, deleteConfirmed: true } : p;
        await this.storage.setItem(key, JSON.stringify(stored));
        return { ...stored };
      });
    this.tails.set(key, next);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === next) this.tails.delete(key);
    }
  }
}
