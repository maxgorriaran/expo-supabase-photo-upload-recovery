import { Image } from 'react-native';

export function verifyImageUri(uri: string, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Image readability check timed out.')),
      timeoutMs,
    );
    Image.getSize(
      uri,
      (width, height) => {
        clearTimeout(timer);
        width > 0 && height > 0 ? resolve() : reject(new Error('Empty image.'));
      },
      () => {
        clearTimeout(timer);
        reject(new Error('Image is not readable.'));
      },
    );
  });
}
