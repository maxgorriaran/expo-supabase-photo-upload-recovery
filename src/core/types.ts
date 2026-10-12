export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const BUCKET = 'photo-recovery';
export const isUuid = (s: unknown): s is string =>
  typeof s === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);

export type Photo = {
  version: 1;
  id: string;
  ownerId: string;
  localUri: string;
  objectPath: string;
  byteLength: number;
  createdAt: number;
  state: 'local' | 'pending' | 'confirmed' | 'deleted';
  deleteConfirmed: boolean;
  lastError?: string;
};
export type RemoteRecord = {
  id: string;
  ownerId: string;
  objectPath: string;
  state: 'ready' | 'deleted';
};
export type ObjectInfo = { byteLength: number; contentType: string };
export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
};
export type LocalFiles = { read(uri: string): Promise<Uint8Array> };
export type Remote = {
  readRecord(photo: Photo): Promise<RemoteRecord | null>;
  inspectObject(photo: Photo): Promise<ObjectInfo | null>;
  upload(photo: Photo, bytes: Uint8Array): Promise<void>;
  verifyImage(photo: Photo): Promise<void>;
  insertRecord(photo: Photo): Promise<RemoteRecord>;
  markDeleted(photo: Photo): Promise<RemoteRecord>;
};
export type Trace = {
  at: number;
  photoId: string;
  stage: string;
  outcome: 'working' | 'ok' | 'unconfirmed';
};
export class RecoveryError extends Error {
  constructor(
    public readonly code: 'stale' | 'deleted' | 'corrupt' | 'missing-file' | 'unconfirmed',
    message: string,
  ) {
    super(message);
    this.name = 'RecoveryError';
  }
}
export const objectPath = (owner: string, id: string) => `${owner}/${id}.jpg`;
