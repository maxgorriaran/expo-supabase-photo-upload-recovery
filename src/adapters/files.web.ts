import { MAX_PHOTO_BYTES } from '../core/types';

// Image bytes live in IndexedDB, never in the small JSON recovery journal.
let database: Promise<IDBDatabase> | undefined;
function open() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('photo-recovery-files', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('files');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
export async function writePhoto(key: string, bytes: Uint8Array): Promise<string> {
  if (!/^[a-z0-9-]+$/.test(key) || !bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES)
    throw new Error('Invalid JPEG or file key.');
  const db = await open(),
    uri = `local-photo://${key}`;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    const request = tx
      .objectStore('files')
      .add(new Blob([Uint8Array.from(bytes).buffer], { type: 'image/jpeg' }), uri);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  return uri;
}
async function blob(uri: string) {
  const db = await open();
  return new Promise<Blob>((resolve, reject) => {
    const request = db.transaction('files').objectStore('files').get(uri);
    request.onsuccess = () =>
      request.result instanceof Blob
        ? resolve(request.result)
        : reject(new Error('Original file missing.'));
    request.onerror = () => reject(request.error);
  });
}
export async function readPhoto(uri: string) {
  return new Uint8Array(await (await blob(uri)).arrayBuffer());
}
export async function existingPhoto(key: string): Promise<string | null> {
  if (!/^[a-z0-9-]+$/.test(key)) throw new Error('Invalid file key.');
  const db = await open(),
    uri = `local-photo://${key}`;
  return new Promise((resolve, reject) => {
    const request = db.transaction('files').objectStore('files').get(uri);
    request.onsuccess = () => resolve(request.result instanceof Blob ? uri : null);
    request.onerror = () => reject(request.error);
  });
}
export async function readSource(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Image import failed.');
  return new Uint8Array(await response.arrayBuffer());
}
export async function previewPhoto(uri: string) {
  return URL.createObjectURL(await blob(uri));
}
export function releasePreview(uri: string) {
  URL.revokeObjectURL(uri);
}
