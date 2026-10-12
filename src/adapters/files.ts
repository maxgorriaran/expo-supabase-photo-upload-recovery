import { Directory, File, Paths } from 'expo-file-system';
import { MAX_PHOTO_BYTES } from '../core/types';

const root = new Directory(Paths.document, 'photo-recovery');
function target(key: string) {
  if (!/^[a-z0-9-]+$/.test(key)) throw new Error('Invalid local file key.');
  root.create({ idempotent: true, intermediates: true });
  return new File(root, `${key}.jpg`);
}
export async function writePhoto(key: string, bytes: Uint8Array): Promise<string> {
  if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES)
    throw new Error('Choose a JPEG smaller than 4 MB.');
  const file = target(key);
  file.create();
  file.write(bytes);
  return file.uri;
}
export async function readPhoto(uri: string) {
  return new File(uri).bytes();
}
export async function existingPhoto(key: string) {
  const file = target(key);
  return file.exists ? file.uri : null;
}
export async function readSource(uri: string) {
  return new File(uri).bytes();
}
export async function previewPhoto(uri: string) {
  return uri;
}
export function releasePreview(_uri: string) {}
