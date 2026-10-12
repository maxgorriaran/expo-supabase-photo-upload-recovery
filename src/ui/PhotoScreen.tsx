import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { previewPhoto, releasePreview } from '../adapters/files';
import { SCENARIOS } from '../adapters/faults';
import { DEMO_A } from '../adapters/demo';
import type { Photo, Trace } from '../core/types';
import type { Runtime } from '../runtime';

const c = {
  ink: '#192a2a',
  muted: '#64716d',
  paper: '#f3f1eb',
  line: '#dedfd7',
  teal: '#166658',
  warning: '#a4472d',
};
type Props = {
  runtime: Runtime | undefined;
  initialError: string;
  photo: Photo | undefined;
  photos: Photo[];
  counts: { objects: number; rows: number; deleted: number };
  traces: Trace[];
  busy: boolean;
  message: string;
  onCapture: (source: 'sample' | 'library' | 'camera') => void;
  onSave: () => void;
  onRemove: () => void;
  onSwitch: () => void;
  onSelect: (id: string) => void;
};
function Button({
  label,
  onPress,
  testID,
  disabled = false,
  primary = false,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        primary && s.primary,
        pressed && { opacity: 0.75 },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text style={[s.buttonText, primary && { color: '#fffefb' }, danger && { color: c.warning }]}>
        {label}
      </Text>
    </Pressable>
  );
}
function Disclosure({
  label,
  open,
  onPress,
  testID,
}: {
  label: string;
  open: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      testID={testID}
      onPress={onPress}
      style={s.disclosure}
    >
      <Text style={s.disclosureText}>{label}</Text>
      <Text style={s.chevron}>{open ? '−' : '+'}</Text>
    </Pressable>
  );
}
function Preview({ photo }: { photo: Photo | undefined }) {
  const [uri, setUri] = useState<string>(),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true,
      loaded: string | undefined;
    setUri(undefined);
    setFailed(false);
    if (photo && photo.state !== 'deleted')
      previewPhoto(photo.localUri)
        .then((next) => {
          loaded = next;
          if (active) setUri(next);
          else releasePreview(next);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    return () => {
      active = false;
      if (loaded) releasePreview(loaded);
    };
  }, [photo?.localUri, photo?.state === 'deleted']);
  return (
    <View style={s.preview} testID="active-photo" nativeID={photo?.id}>
      {uri ? (
        <Image
          accessibilityLabel="Photo preview"
          source={{ uri }}
          resizeMode="cover"
          style={s.image}
        />
      ) : photo && photo.state !== 'deleted' && !failed ? (
        <ActivityIndicator color={c.teal} />
      ) : (
        <View style={s.empty}>
          <Text style={s.emptyMark}>{photo?.state === 'deleted' ? '×' : '+'}</Text>
          <Text testID={!photo ? 'no-capture' : undefined} style={s.emptyTitle}>
            {photo?.state === 'deleted'
              ? 'Photo removed'
              : failed
                ? 'Preview unavailable'
                : 'No photo yet'}
          </Text>
          {failed && <Text style={s.copy}>The local image could not be read.</Text>}
        </View>
      )}
    </View>
  );
}
const stateLabel = (p: Photo) =>
  p.state === 'confirmed'
    ? 'Saved'
    : p.state === 'pending'
      ? 'Pending'
      : p.state === 'deleted'
        ? 'Removed'
        : 'Local';
export function PhotoScreen({
  runtime,
  initialError,
  photo,
  photos,
  counts,
  traces,
  busy,
  message,
  onCapture,
  onSave,
  onRemove,
  onSwitch,
  onSelect,
}: Props) {
  const [testing, setTesting] = useState(false),
    [details, setDetails] = useState(false),
    [sources, setSources] = useState(false),
    [allPhotos, setAllPhotos] = useState(false);
  const owner = runtime?.owner();
  useEffect(() => {
    setTesting(false);
    setDetails(false);
    setSources(false);
    setAllPhotos(false);
  }, [owner]);
  useEffect(() => {
    setSources(false);
  }, [photo?.id]);
  const state = photo?.state;
  const uncertain = state === 'pending' || !!photo?.lastError;
  const status =
    state === 'confirmed'
      ? photo?.lastError
        ? 'Verification unconfirmed'
        : 'Cloud confirmed'
      : state === 'pending'
        ? 'Save unconfirmed'
        : state === 'deleted'
          ? photo?.deleteConfirmed
            ? 'Removal confirmed'
            : 'Removed locally'
          : 'Local only';
  const help =
    state === 'confirmed'
      ? photo?.lastError
        ? 'Previously saved. This check failed; nothing was recreated.'
        : 'The image and its database record are confirmed.'
      : state === 'pending'
        ? 'Kept on this device. Retry checks what already saved.'
        : state === 'deleted'
          ? 'A retry cannot bring this capture back.'
          : 'Your original is on this device. Ready when you are.';
  const genericSaveError = message.startsWith('Cloud save is unconfirmed');
  const scenario = SCENARIOS.find((item) => item.id === runtime?.faults.scenario);
  const latest = new Map<string, Trace>();
  traces.filter((t) => t.photoId === photo?.id).forEach((t) => latest.set(t.stage, t));
  if (!runtime)
    return (
      <SafeAreaView style={[s.root, s.loading]}>
        {initialError ? (
          <Text style={s.error}>{initialError}</Text>
        ) : (
          <>
            <ActivityIndicator color={c.teal} />
            <Text style={s.copy}>Opening recovery storage…</Text>
          </>
        )}
      </SafeAreaView>
    );
  const ownerLabel =
    runtime.mode === 'demo'
      ? owner === DEMO_A
        ? 'Account A'
        : 'Account B'
      : `Account ${owner?.slice(0, 6) ?? '—'}`;
  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.page}>
        <View style={s.header}>
          <Text accessibilityRole="header" style={s.title}>
            Photo recovery
          </Text>
          <Text style={s.mode}>
            {runtime.mode === 'demo' ? 'Demo · simulated cloud' : 'Connected · Supabase'}
          </Text>
        </View>
        {!photo && <Text style={s.intro}>Keep the photo when a save gets interrupted.</Text>}
        <Preview photo={photo} />
        {photo && (
          <View style={s.feedback} accessibilityLiveRegion="polite">
            <Text
              testID="photo-status"
              style={[s.status, { color: uncertain ? c.warning : c.teal }]}
            >
              {status}
            </Text>
            <Text style={s.copy}>{help}</Text>
          </View>
        )}
        {!!message && !genericSaveError && (
          <Text testID="operation-message" style={s.error}>
            {message}
          </Text>
        )}
        <View style={s.mainAction}>
          {photo && state !== 'deleted' ? (
            <Button
              primary
              testID="save-photo"
              label={
                busy
                  ? 'Working…'
                  : state === 'pending'
                    ? 'Retry save'
                    : state === 'confirmed'
                      ? 'Verify again'
                      : 'Save photo'
              }
              disabled={busy}
              onPress={onSave}
            />
          ) : state === 'deleted' && !photo?.deleteConfirmed ? (
            <Button
              primary
              testID="remove-photo"
              label={busy ? 'Working…' : 'Retry cloud removal'}
              disabled={busy}
              onPress={onRemove}
            />
          ) : (
            <Button
              primary
              testID="sample-photo"
              label={busy ? 'Working…' : 'Use sample photo'}
              disabled={busy}
              onPress={() => onCapture('sample')}
            />
          )}
          {(!photo || state === 'deleted') && (
            <View style={s.sourceRow}>
              <Button label="Photo library" disabled={busy} onPress={() => onCapture('library')} />
              <Button label="Camera" disabled={busy} onPress={() => onCapture('camera')} />
            </View>
          )}
        </View>
        <Text style={s.storage} testID="cloud-summary">
          Account storage: <Text testID="object-count">{counts.objects}</Text>{' '}
          {counts.objects === 1 ? 'image' : 'images'} ·{' '}
          <Text testID="row-count">{counts.rows}</Text> ready{' '}
          {counts.rows === 1 ? 'record' : 'records'}
        </Text>
        {scenario?.id !== 'normal' && (
          <Text testID="scenario-hint" style={s.hint}>
            Test: {scenario?.label}
            {runtime.faults.offline ? ' · requests paused' : ''}
          </Text>
        )}
        {runtime.faults.offline && (
          <Text testID="network-status" style={s.hint}>
            Injected interruption. Retry resumes requests.
          </Text>
        )}
        <View style={s.utilities}>
          {photo && state !== 'deleted' && (
            <Disclosure
              label="New photo"
              testID="new-photo"
              open={sources}
              onPress={() => setSources(!sources)}
            />
          )}
          {sources && state !== 'deleted' && (
            <View style={s.reveal}>
              <Button
                testID="sample-photo"
                label="Use sample photo"
                disabled={busy}
                onPress={() => onCapture('sample')}
              />
              <View style={s.sourceRow}>
                <Button
                  label="Photo library"
                  disabled={busy}
                  onPress={() => onCapture('library')}
                />
                <Button label="Camera" disabled={busy} onPress={() => onCapture('camera')} />
              </View>
            </View>
          )}
          <Disclosure
            label="Test a failure"
            testID="toggle-failures"
            open={testing}
            onPress={() => setTesting(!testing)}
          />
          {testing && (
            <View style={s.reveal}>
              <Text style={s.copy}>Inject one failure into the next save.</Text>
              {SCENARIOS.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole={Platform.OS === 'web' ? 'radio' : 'button'}
                  accessibilityLabel={item.label}
                  accessibilityState={{
                    selected: runtime.faults.scenario === item.id,
                    disabled: busy,
                  }}
                  testID={`scenario-${item.id}`}
                  disabled={busy}
                  onPress={() => {
                    runtime.faults.select(item.id);
                    setTesting(false);
                  }}
                  style={s.choice}
                >
                  <Text style={s.choiceText}>{item.label}</Text>
                  <Text style={s.choiceMark}>
                    {runtime.faults.scenario === item.id ? '●' : '○'}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {photos.length > 1 && (
            <Disclosure
              label={`Photos (${photos.length})`}
              testID="toggle-photos"
              open={allPhotos}
              onPress={() => setAllPhotos(!allPhotos)}
            />
          )}
          {allPhotos && (
            <View style={s.reveal}>
              {photos.map((p, index) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Photo ${photos.length - index}, ${stateLabel(p)}`}
                  testID={`capture-${p.id}`}
                  disabled={busy}
                  onPress={() => {
                    onSelect(p.id);
                    setAllPhotos(false);
                  }}
                  style={s.choice}
                >
                  <Text style={s.choiceText}>Photo {photos.length - index}</Text>
                  <Text style={s.copy}>
                    {stateLabel(p)}
                    {p.id === photo?.id ? ' ✓' : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <Disclosure
            label="Details"
            testID="toggle-details"
            open={details}
            onPress={() => setDetails(!details)}
          />
          {details && (
            <View style={s.reveal}>
              <View style={s.account}>
                <Text testID="account-label" style={s.copy}>
                  {ownerLabel}
                </Text>
                <Button
                  testID="switch-account"
                  label={runtime.mode === 'demo' ? 'Switch account' : 'New test account'}
                  onPress={onSwitch}
                />
              </View>
              {photo && (
                <Text testID="capture-id" style={s.small}>
                  ID {photo.id.slice(0, 8)} · {Math.ceil(photo.byteLength / 1024)} KB · JPEG
                </Text>
              )}
              <Text style={s.small}>
                <Text testID="deleted-count">{counts.deleted}</Text> deletion{' '}
                {counts.deleted === 1 ? 'record' : 'records'}
              </Text>
              {[...latest.values()].map((t) => (
                <View key={t.stage} style={s.traceRow}>
                  <Text
                    style={[
                      s.traceMark,
                      { color: t.outcome === 'unconfirmed' ? c.warning : c.teal },
                    ]}
                  >
                    {t.outcome === 'ok' ? '✓' : t.outcome === 'unconfirmed' ? '!' : '·'}
                  </Text>
                  <Text style={s.copy}>{t.stage}</Text>
                </View>
              ))}
              {photo && state !== 'deleted' && (
                <View style={s.removal}>
                  <Button testID="remove-photo" label="Remove photo" danger onPress={onRemove} />
                  <Text style={s.small}>
                    Soft removal from this demo. Image files are retained.
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
        <Text style={s.footer}>Expo + Supabase · AutonoMax Innovations</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  page: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: 24, paddingBottom: 32 },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  header: { gap: 5, marginBottom: 22 },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.7, color: c.ink },
  mode: { fontSize: 12, lineHeight: 18, color: c.muted },
  intro: { fontSize: 16, lineHeight: 24, color: c.muted, marginBottom: 20 },
  preview: {
    height: 280,
    backgroundColor: '#e4e6de',
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: { width: '100%', height: '100%' },
  empty: { alignItems: 'center', gap: 12, padding: 20 },
  emptyMark: { fontSize: 44, lineHeight: 48, color: c.muted, fontWeight: '300' },
  emptyTitle: { fontSize: 16, color: c.muted },
  feedback: { gap: 7, marginTop: 22 },
  status: { fontSize: 19, lineHeight: 25, fontWeight: '600' },
  copy: { fontSize: 14, lineHeight: 21, color: c.muted },
  error: { fontSize: 13, lineHeight: 20, color: c.warning, marginTop: 12 },
  mainAction: { marginTop: 22, gap: 6 },
  button: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  primary: { backgroundColor: c.teal },
  buttonText: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: c.ink },
  sourceRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, flexWrap: 'wrap' },
  storage: { fontSize: 12, lineHeight: 20, color: c.muted, textAlign: 'center', marginTop: 14 },
  hint: { fontSize: 12, lineHeight: 19, color: c.warning, textAlign: 'center', marginTop: 5 },
  utilities: { marginTop: 24, borderTopWidth: 1, borderTopColor: c.line },
  disclosure: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
  disclosureText: { fontSize: 14, lineHeight: 22, color: c.ink },
  chevron: { fontSize: 18, lineHeight: 22, color: c.muted },
  reveal: { paddingBottom: 12, gap: 9 },
  choice: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
  choiceText: { fontSize: 14, lineHeight: 22, color: c.ink },
  choiceMark: { fontSize: 18, color: c.teal },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  small: { fontSize: 12, lineHeight: 19, color: c.muted },
  traceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  traceMark: { width: 14, fontSize: 15 },
  removal: { marginTop: 12, alignItems: 'flex-start', gap: 4 },
  footer: { fontSize: 11, lineHeight: 17, color: c.muted, marginTop: 24, textAlign: 'center' },
});
