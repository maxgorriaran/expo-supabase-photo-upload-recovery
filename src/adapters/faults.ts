import type { Remote } from '../core/types';

export type Scenario =
  | 'normal'
  | 'upload-rejected'
  | 'upload-response-lost'
  | 'row-rejected'
  | 'row-response-lost'
  | 'offline';
export const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'normal', label: 'Normal save' },
  { id: 'upload-response-lost', label: 'Lost upload response' },
  { id: 'row-rejected', label: 'Database rejects save' },
  { id: 'row-response-lost', label: 'Lost database response' },
  { id: 'upload-rejected', label: 'Upload rejects save' },
  { id: 'offline', label: 'Offline' },
];

/** Explicit fault injection; the same wrapper works around the demo and Supabase adapters. */
export class Faults {
  scenario: Scenario = 'normal';
  offline = false;
  private armed = false;
  private listeners = new Set<() => void>();
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private changed() {
    this.listeners.forEach((fn) => fn());
  }
  select(scenario: Scenario) {
    this.scenario = scenario;
    this.armed = true;
    this.offline = scenario === 'offline';
    this.changed();
  }
  reconnect() {
    this.offline = false;
    this.armed = false;
    this.changed();
  }
  restore(scenario: Scenario, offline: boolean) {
    this.scenario = scenario;
    this.offline = offline;
    this.armed = false;
  }
  private check() {
    if (this.offline) {
      this.armed = false;
      throw new Error('Injected network interruption.');
    }
  }
  get needsReconnect() {
    return this.offline && !this.armed;
  }
  private hit(scenario: Scenario) {
    if (this.armed && this.scenario === scenario) {
      this.armed = false;
      return true;
    }
    return false;
  }
  wrap(remote: Remote): Remote {
    return {
      readRecord: async (p) => {
        this.check();
        return remote.readRecord(p);
      },
      inspectObject: async (p) => {
        this.check();
        return remote.inspectObject(p);
      },
      verifyImage: async (p) => {
        this.check();
        return remote.verifyImage(p);
      },
      upload: async (p, bytes) => {
        this.check();
        if (this.hit('upload-rejected')) throw new Error('Injected rejected upload.');
        await remote.upload(p, bytes);
        if (this.hit('upload-response-lost')) {
          this.offline = true;
          this.changed();
          throw new Error('Injected lost upload acknowledgement.');
        }
      },
      insertRecord: async (p) => {
        this.check();
        if (this.hit('row-rejected')) throw new Error('Injected rejected database write.');
        const row = await remote.insertRecord(p);
        if (this.hit('row-response-lost')) {
          this.offline = true;
          this.changed();
          throw new Error('Injected lost database acknowledgement.');
        }
        return row;
      },
      markDeleted: async (p) => {
        this.check();
        return remote.markDeleted(p);
      },
    };
  }
}
