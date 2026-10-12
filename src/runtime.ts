import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'expo-crypto';
import { PhotoJournal } from './core/journal';
import { PhotoRecovery } from './core/recovery';
import { withDeadline } from './core/deadline';
import { BUCKET, type Trace } from './core/types';
import { Faults, SCENARIOS } from './adapters/faults';
import { DemoCloud, DEMO_A, DEMO_B } from './adapters/demo';
import { readPhoto } from './adapters/files';
import { verifyImageUri } from './adapters/image';
import { limitedFetch, supabaseRemote } from './adapters/supabase';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const configured =
  /^https?:\/\//.test(url) && !!key && !url.includes('YOUR_') && !key.includes('YOUR_');
export async function createRuntime(onTrace: (trace: Trace) => void) {
  const faults = new Faults(),
    cloud = new DemoCloud(AsyncStorage),
    journal = new PhotoJournal(AsyncStorage);
  const cachedFaults = await AsyncStorage.getItem('photo-recovery:faults');
  if (cachedFaults) {
    try {
      const saved = JSON.parse(cachedFaults);
      if (SCENARIOS.some((s) => s.id === saved.scenario) && typeof saved.offline === 'boolean')
        faults.restore(saved.scenario, saved.offline);
    } catch {
      /* A damaged demo setting must not damage a capture. */
    }
  }
  let settingsTail = Promise.resolve();
  const stopFaults = faults.subscribe(() => {
    const raw = JSON.stringify({ scenario: faults.scenario, offline: faults.offline });
    settingsTail = settingsTail
      .catch(() => undefined)
      .then(() => AsyncStorage.setItem('photo-recovery:faults', raw));
  });
  let owner: string | null = null;
  const client = configured
    ? createClient(url, key, {
        auth: {
          storage: AsyncStorage,
          storageKey: 'photo-recovery:auth',
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
        global: { fetch: limitedFetch },
      })
    : null;
  const recovery = new PhotoRecovery({
    journal,
    files: { read: readPhoto },
    createId: randomUUID,
    onTrace,
    remote: async (expectedOwner) => {
      if (!client) return withDeadline(faults.wrap(cloud.forOwner(expectedOwner)));
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session || data.session.user.id !== expectedOwner)
        throw new Error('Account changed.');
      return withDeadline(
        faults.wrap(
          supabaseRemote(url, key, expectedOwner, data.session.access_token, verifyImageUri),
        ),
      );
    },
  });
  const setOwner = (next: string | null) => {
    if (next !== owner) {
      owner = next;
      recovery.setAccount(next);
    }
  };
  let stopAuth = () => {};
  let stopState = () => {};
  if (client) {
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setOwner(session?.user.id ?? null);
    });
    stopAuth = () => data.subscription.unsubscribe();
    const { data: session, error } = await client.auth.getSession();
    if (error) throw error;
    if (session.session) setOwner(session.session.user.id);
    else {
      const { data: signed, error: signError } = await client.auth.signInAnonymously();
      if (signError)
        throw new Error('Anonymous sign-in failed. Enable it in your separate Supabase project.');
      setOwner(signed.user!.id);
    }
    if (Platform.OS !== 'web') {
      if (AppState.currentState === 'active') client.auth.startAutoRefresh();
      const sub = AppState.addEventListener('change', (state) =>
        state === 'active' ? client.auth.startAutoRefresh() : client.auth.stopAutoRefresh(),
      );
      stopState = () => {
        sub.remove();
        client.auth.stopAutoRefresh();
      };
    }
  } else {
    setOwner(
      (await AsyncStorage.getItem('photo-recovery:demo-account')) === DEMO_B ? DEMO_B : DEMO_A,
    );
  }
  return {
    recovery,
    faults,
    mode: client ? ('supabase' as const) : ('demo' as const),
    owner: () => owner,
    async switchAccount() {
      recovery.setAccount(null);
      owner = null;
      if (client) {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw error;
        const { data, error: nextError } = await client.auth.signInAnonymously();
        if (nextError) throw nextError;
        setOwner(data.user!.id);
      } else {
        const old = await AsyncStorage.getItem('photo-recovery:demo-account');
        const next = old === DEMO_B ? DEMO_A : DEMO_B;
        await AsyncStorage.setItem('photo-recovery:demo-account', next);
        setOwner(next);
      }
    },
    async counts() {
      const active = owner;
      if (!active) return { objects: 0, rows: 0, deleted: 0 };
      if (!client) return cloud.counts(active);
      const [files, rows] = await Promise.all([
        client.storage.from(BUCKET).list(active, { limit: 100 }),
        client.from('photo_saves').select('state').eq('owner_id', active).limit(100),
      ]);
      if (files.error) throw files.error;
      if (rows.error) throw rows.error;
      return {
        objects: files.data.filter((f) => !!f.id).length,
        rows: rows.data.filter((p) => p.state === 'ready').length,
        deleted: rows.data.filter((p) => p.state === 'deleted').length,
      };
    },
    dispose() {
      stopFaults();
      stopAuth();
      stopState();
    },
  };
}
export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
