import { RecoveryError, type Remote } from './types';

/** A timeout ends the wait, not the server mutation. Recovery must reconcile its result. */
export function withDeadline(remote: Remote, timeoutMs = 20_000): Remote {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid request deadline.');
  function wait<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new RecoveryError(
              'unconfirmed',
              'Request timed out. The server may have saved it. Retry checks first.',
            ),
          ),
        timeoutMs,
      );
      Promise.resolve()
        .then(operation)
        .then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
    });
  }
  return {
    readRecord: (p) => wait(() => remote.readRecord(p)),
    inspectObject: (p) => wait(() => remote.inspectObject(p)),
    upload: (p, b) => wait(() => remote.upload(p, b)),
    verifyImage: (p) => wait(() => remote.verifyImage(p)),
    insertRecord: (p) => wait(() => remote.insertRecord(p)),
    markDeleted: (p) => wait(() => remote.markDeleted(p)),
  };
}
