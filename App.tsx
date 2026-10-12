import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { Asset } from 'expo-asset';
import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createRuntime, type Runtime } from './src/runtime';
import { readSource, writePhoto } from './src/adapters/files';
import { PhotoScreen } from './src/ui/PhotoScreen';
import type { Photo, Trace } from './src/core/types';

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppContent />
    </SafeAreaProvider>
  );
}
function AppContent() {
  const [runtime, setRuntime] = useState<Runtime>();
  const [initialError, setInitialError] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [traces, setTraces] = useState<Trace[]>([]);
  const [counts, setCounts] = useState<Awaited<ReturnType<Runtime['counts']>> | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false),
    [, redraw] = useState(0);
  const [activity, setActivity] = useState<'capture' | 'save' | 'remove'>();
  const operation = useRef(0);
  const refreshVersion = useRef(0);
  const photo =
    photos.find((p) => p.id === selectedId) ??
    photos.find(
      (p) =>
        p.state === 'pending' || !!p.lastError || (p.state === 'deleted' && !p.deleteConfirmed),
    ) ??
    photos.find((p) => p.state === 'local') ??
    photos[0];
  useEffect(() => {
    let active = true,
      created: Runtime | undefined;
    createRuntime((trace) => {
      if (active) setTraces((old) => [...old.slice(-19), trace]);
    })
      .then((r) => {
        created = r;
        if (active) setRuntime(r);
        else r.dispose();
      })
      .catch(() => {
        if (active)
          setInitialError(
            'Could not open recovery storage or sign in. Check browser storage permissions, network, and Supabase setup.',
          );
      });
    return () => {
      active = false;
      created?.dispose();
    };
  }, []);
  const refresh = async (r: Runtime) => {
    const owner = r.owner(),
      version = ++refreshVersion.current;
    const current = () => r.owner() === owner && refreshVersion.current === version;
    await Promise.all([
      (async () => {
        try {
          const next = await r.recovery.list();
          if (current()) {
            setPhotos(next);
            redraw((n) => n + 1);
          }
        } catch {
          if (current()) setMessage('Could not read photos on this device. Check storage access.');
        }
      })(),
      (async () => {
        try {
          const remote = await r.counts();
          if (current()) setCounts(remote);
        } catch {
          if (current()) setCounts(null);
        }
      })(),
    ]);
  };
  useEffect(() => {
    if (!runtime) return;
    let owner = runtime.owner();
    const stop = runtime.recovery.subscribe(() => {
      if (owner !== runtime.owner()) {
        owner = runtime.owner();
        operation.current++;
        setPhotos([]);
        setCounts(null);
        setSelectedId(undefined);
        setTraces([]);
        setMessage('');
        setBusy(false);
        setActivity(undefined);
      }
      void refresh(runtime);
    });
    const stopFaults = runtime.faults.subscribe(() => redraw((n) => n + 1));
    void refresh(runtime);
    return () => {
      refreshVersion.current++;
      stop();
      stopFaults();
    };
  }, [runtime]);
  const run = async (
    work: (r: Runtime, owner: string) => Promise<void>,
    kind: 'capture' | 'save' | 'remove',
  ) => {
    if (!runtime || !runtime.owner()) return;
    const ticket = ++operation.current,
      owner = runtime.owner()!;
    setBusy(true);
    setActivity(kind);
    setMessage('');
    try {
      await work(runtime, owner);
    } catch (error) {
      if (operation.current === ticket && runtime.owner() === owner)
        setMessage(
          error instanceof Error ? error.message : 'Save is unconfirmed. Retry when connected.',
        );
    } finally {
      if (operation.current === ticket) {
        setBusy(false);
        setActivity(undefined);
        await refresh(runtime);
      }
    }
  };
  const capture = async (source: 'sample' | 'library' | 'camera') =>
    run(async (r, owner) => {
      let uri: string;
      if (source === 'sample') {
        const asset = Asset.fromModule(require('./assets/sample-coast.jpg'));
        await asset.downloadAsync();
        uri = asset.localUri ?? asset.uri;
      } else {
        if (source === 'camera') {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted)
            throw new Error(
              'Camera permission was not granted. Use the sample or your photo library.',
            );
        } else if (Platform.OS !== 'web') {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!permission.granted) throw new Error('Photo library permission was not granted.');
        }
        const result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
            : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
        if (result.canceled || !result.assets[0]) return;
        uri = result.assets[0].uri;
      }
      const context = ImageManipulator.manipulate(uri);
      let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
      try {
        context.resize({ width: 1280 });
        rendered = await context.renderAsync();
        const normalized = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
        const bytes = await readSource(normalized.uri);
        if (r.owner() !== owner) return;
        const id = randomUUID(),
          localUri = await writePhoto(`capture-${id}`, bytes);
        if (r.owner() !== owner) return;
        await r.recovery.capture(localUri, bytes.byteLength, id);
        setSelectedId(id);
        setTraces([]);
      } finally {
        rendered?.release();
        context.release();
      }
    }, 'capture');
  return (
    <PhotoScreen
      runtime={runtime}
      initialError={initialError}
      photo={photo}
      photos={photos}
      counts={counts}
      traces={traces}
      busy={busy}
      activity={activity}
      message={message}
      onCapture={(source) => void capture(source)}
      onSave={(id) => {
        setSelectedId(id);
        void run(async (r) => {
          if (r.faults.needsReconnect) r.faults.reconnect();
          await r.recovery.save(id);
        }, 'save');
      }}
      onRemove={(id) => {
        setSelectedId(id);
        void run(async (r) => {
          if (r.faults.needsReconnect) r.faults.reconnect();
          await r.recovery.remove(id);
        }, 'remove');
      }}
      onSelect={setSelectedId}
      onSwitch={() => {
        operation.current++;
        refreshVersion.current++;
        setBusy(false);
        setActivity(undefined);
        setPhotos([]);
        setCounts(null);
        setTraces([]);
        setMessage('');
        void runtime
          ?.switchAccount()
          .then(() => refresh(runtime))
          .catch(() => setMessage('Could not switch accounts.'));
      }}
    />
  );
}
