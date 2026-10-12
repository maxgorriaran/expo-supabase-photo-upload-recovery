import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { previewPhoto, releasePreview } from '../adapters/files';
import { SCENARIOS } from '../adapters/faults';
import { DEMO_A } from '../adapters/demo';
import type { Photo, Trace } from '../core/types';
import type { Runtime } from '../runtime';

const c = {
  ink: '#182e27',
  muted: '#5f7067',
  paper: '#f7f9f6',
  white: '#ffffff',
  line: '#dce4dd',
  green: '#245c47',
  greenWash: '#e6f0e8',
  warning: '#89451f',
  warningWash: '#f8eee2',
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
function FocusPressable({
  style,
  onFocus,
  onBlur,
  focusColor = c.green,
  ...props
}: React.ComponentProps<typeof Pressable> & { focusColor?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...props}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={(state) => [
        typeof style === 'function' ? style(state) : style,
        focused && { borderColor: focusColor },
      ]}
    />
  );
}
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
    <FocusPressable
      focusColor={primary ? c.white : c.green}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        primary && s.primary,
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={[s.buttonText, primary && { color: c.white }, danger && { color: c.warning }]}>
        {label}
      </Text>
    </FocusPressable>
  );
}
function Disclosure({
  label,
  open,
  onPress,
  testID,
  disabled = false,
  value,
}: {
  label: string;
  open: boolean;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  value?: string;
}) {
  return (
    <FocusPressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}` : label}
      accessibilityState={{ expanded: open, disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.disclosure,
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <View style={s.disclosureLabel}>
        <Text style={s.disclosureText}>{label}</Text>
        {value && (
          <Text testID="scenario-hint" style={s.small}>
            {value}
          </Text>
        )}
      </View>
      <Text accessible={false} style={s.chevron}>
        {open ? '−' : '+'}
      </Text>
    </FocusPressable>
  );
}
type PreviewRead = { localUri: string; available: boolean };
function Preview({
  photo,
  onRead,
}: {
  photo: Photo | undefined;
  onRead: (read: PreviewRead) => void;
}) {
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
          if (active) {
            setFailed(true);
            onRead({ localUri: photo.localUri, available: false });
          }
        });
    return () => {
      active = false;
      if (loaded) releasePreview(loaded);
    };
  }, [photo?.localUri, photo?.state === 'deleted', onRead]);
  const removed = photo?.state === 'deleted';
  return (
    <View style={s.preview} testID="active-photo" nativeID={photo?.id}>
      {!photo ? (
        <>
          <Image
            accessibilityLabel="AI-generated sample coastline"
            source={require('../../assets/sample-coast.jpg')}
            resizeMode="cover"
            style={s.image}
          />
          <View style={s.sampleCaption}>
            <Text testID="no-capture" style={s.sampleCaptionText}>
              Sample photo · AI generated
            </Text>
          </View>
        </>
      ) : uri && !failed ? (
        <Image
          key={photo.id}
          accessibilityLabel="Photo preview"
          source={{ uri }}
          resizeMode="cover"
          style={s.image}
          onLoad={() => onRead({ localUri: photo.localUri, available: true })}
          onError={() => {
            setFailed(true);
            onRead({ localUri: photo.localUri, available: false });
          }}
        />
      ) : !removed && !failed ? (
        <ActivityIndicator color={c.green} accessibilityLabel="Loading photo preview" />
      ) : (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>{removed ? 'Photo removed' : 'Preview unavailable'}</Text>
          <Text style={s.copy}>
            {removed
              ? 'A retry cannot restore this capture.'
              : 'The local image could not be read.'}
          </Text>
        </View>
      )}
    </View>
  );
}
function AccountTotals({ counts }: { counts: Props['counts'] }) {
  return (
    <View testID="cloud-summary" style={s.totals}>
      <Text style={s.small}>Account totals</Text>
      <Text style={s.totalsValue}>
        <Text testID="object-count">{counts.objects}</Text>{' '}
        {counts.objects === 1 ? 'image' : 'images'} · <Text testID="row-count">{counts.rows}</Text>{' '}
        saved {counts.rows === 1 ? 'record' : 'records'}
      </Text>
    </View>
  );
}
function ReceiptStep({
  number,
  label,
  value,
  tone = 'idle',
  testID,
  largeText,
}: {
  number: string;
  label: string;
  value: string;
  tone?: 'idle' | 'done' | 'uncertain' | 'working';
  testID: string;
  largeText: boolean;
}) {
  const color = tone === 'done' ? c.green : tone === 'uncertain' ? c.warning : c.muted;
  return (
    <View
      style={[s.receiptStep, largeText && s.receiptStepLarge]}
      accessible
      accessibilityLabel={`${label}: ${value}`}
      testID={testID}
    >
      <View
        style={[s.stepMark, tone === 'done' && s.stepDone, tone === 'uncertain' && s.stepUncertain]}
      >
        {tone === 'working' ? (
          <ActivityIndicator color={color} size="small" />
        ) : (
          <Text accessible={false} allowFontScaling={false} style={[s.stepNumber, { color }]}>
            {number}
          </Text>
        )}
      </View>
      <View style={[s.stepCopy, largeText && { flex: 1 }]}>
        <Text style={s.stepLabel}>{label}</Text>
        <Text style={[s.stepValue, { color }]}>{value}</Text>
      </View>
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
  const interrupted = useRef(new Set<string>());
  const largeText = useWindowDimensions().fontScale >= 1.4;
  const scroll = useRef<ScrollView>(null);
  const [previewRead, setPreviewRead] = useState<PreviewRead>();
  const owner = runtime?.owner();
  useEffect(() => {
    setTesting(false);
    setDetails(false);
    setSources(false);
    setAllPhotos(false);
    interrupted.current.clear();
  }, [owner]);
  useEffect(() => {
    setSources(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [owner, photo?.id]);
  useEffect(() => {
    if (photo?.state === 'pending' && photo.lastError) interrupted.current.add(photo.id);
  }, [photo?.id, photo?.state, photo?.lastError]);
  const state = photo?.state;
  const uncertain = state === 'pending' || !!photo?.lastError;
  const saved = state === 'confirmed' && !photo?.lastError;
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
  useEffect(() => {
    if (Platform.OS === 'ios' && photo) AccessibilityInfo.announceForAccessibility(status);
  }, [photo?.id, status]);
  const missingOriginal = !!photo?.lastError?.startsWith('The original JPEG');
  const localUnavailable =
    missingOriginal ||
    (previewRead?.localUri === photo?.localUri && previewRead?.available === false);
  const localReadable =
    previewRead?.localUri === photo?.localUri && previewRead?.available === true;
  const title = !photo
    ? 'Keep the photo.\nRecover the save.'
    : missingOriginal
      ? 'Original unavailable.'
      : state === 'local' && localUnavailable
        ? 'Local photo unavailable.'
        : state === 'confirmed'
          ? photo.lastError
            ? 'Check interrupted.'
            : interrupted.current.has(photo.id)
              ? 'Recovered.'
              : 'Photo saved.'
          : state === 'pending'
            ? 'Interrupted.\nReady to recover.'
            : state === 'deleted'
              ? 'Photo removed.'
              : 'Ready to save.';
  const help = !photo
    ? 'Try an interrupted save, then recover the same photo.'
    : missingOriginal
      ? 'The original file could not be read. No replacement was uploaded.'
      : state === 'local' && localUnavailable
        ? 'The preview cannot be read. Save checks the cloud before attempting an upload.'
        : state === 'confirmed'
          ? photo.lastError
            ? 'Previously saved. Retry verifies it again without recreating it.'
            : 'Same capture. Image and save record verified.'
          : state === 'pending'
            ? 'Retry checks what reached the cloud, then finishes this capture.'
            : state === 'deleted'
              ? 'This is soft removal. Image files are retained.'
              : 'Your JPEG is on this device. The cloud save comes next.';
  const latest = new Map<string, Trace>();
  traces.filter((t) => t.photoId === photo?.id).forEach((t) => latest.set(t.stage, t));
  // Only this capture's verified stages can turn a receipt step green. Account totals cannot.
  const imageKnown = saved || latest.get('Verify readable image')?.outcome === 'ok';
  const recordKnown = saved || latest.get('Save database record')?.outcome === 'ok';
  const currentTrace = traces.filter((t) => t.photoId === photo?.id).at(-1);
  const imageWorking =
    busy &&
    currentTrace?.outcome === 'working' &&
    ['Check stored image', 'Upload image', 'Verify readable image'].includes(currentTrace.stage);
  const recordWorking = busy && latest.get('Save database record')?.outcome === 'working';
  const scenario = SCENARIOS.find((item) => item.id === runtime?.faults.scenario);
  if (!runtime)
    return (
      <SafeAreaView style={[s.root, s.loading]}>
        {initialError ? (
          <>
            <Text style={s.loadingTitle}>Could not open recovery</Text>
            <Text style={s.error}>{initialError}</Text>
          </>
        ) : (
          <>
            <ActivityIndicator color={c.green} />
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
  const photoSources = sources && (
    <View style={s.sources}>
      <Button
        testID="sample-photo"
        label="Use sample photo"
        disabled={busy}
        onPress={() => onCapture('sample')}
      />
      <View style={s.sourceRow}>
        <Button label="Photo library" disabled={busy} onPress={() => onCapture('library')} />
        <Button label="Camera" disabled={busy} onPress={() => onCapture('camera')} />
      </View>
    </View>
  );
  return (
    <SafeAreaView style={s.root}>
      <ScrollView ref={scroll} contentContainerStyle={s.page}>
        <View style={s.header}>
          <Text maxFontSizeMultiplier={1.6} style={s.brand}>
            Photo recovery
          </Text>
          <Text style={s.mode}>
            {runtime.mode === 'demo' ? 'Demo · simulated cloud' : 'Connected · Supabase'}
          </Text>
        </View>
        <View style={s.story} accessibilityLiveRegion="polite">
          <Text
            testID={photo ? 'photo-status' : undefined}
            maxFontSizeMultiplier={1.8}
            style={[s.eyebrow, { color: uncertain ? c.warning : c.green }]}
          >
            {photo ? status : 'Expo + Supabase starter'}
          </Text>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.6}
            style={[s.title, saved && { color: c.green }]}
          >
            {title}
          </Text>
          <Text style={s.help}>{help}</Text>
        </View>
        <Preview photo={photo} onRead={setPreviewRead} />
        {state !== 'deleted' && (
          <View style={s.receipt} testID="save-receipt">
            <View style={s.receiptHeading}>
              <Text style={s.receiptTitle}>{photo ? 'This capture' : 'The recovery flow'}</Text>
              {photo && (
                <Text
                  testID="capture-id"
                  accessibilityLabel={`Capture ID ${photo.id}`}
                  style={s.captureId}
                >
                  {photo.id.slice(0, 8)}
                </Text>
              )}
            </View>
            <View style={[s.receiptSteps, largeText && s.receiptStepsLarge]}>
              <ReceiptStep
                number="01"
                label="On device"
                value={
                  !photo
                    ? 'Capture first'
                    : localUnavailable
                      ? 'Unavailable'
                      : localReadable
                        ? 'Kept'
                        : 'Loading…'
                }
                tone={
                  !photo
                    ? 'idle'
                    : localUnavailable
                      ? 'uncertain'
                      : localReadable
                        ? 'done'
                        : 'working'
                }
                testID="receipt-device"
                largeText={largeText}
              />
              <ReceiptStep
                number="02"
                label="Cloud image"
                value={
                  photo?.lastError && state === 'confirmed'
                    ? 'Recheck needed'
                    : imageWorking
                      ? 'Checking…'
                      : imageKnown
                        ? 'Verified'
                        : state === 'pending'
                          ? 'Unconfirmed'
                          : 'Not sent'
                }
                tone={
                  photo?.lastError && state === 'confirmed'
                    ? 'uncertain'
                    : imageWorking
                      ? 'working'
                      : imageKnown
                        ? 'done'
                        : state === 'pending'
                          ? 'uncertain'
                          : 'idle'
                }
                testID="receipt-image"
                largeText={largeText}
              />
              <ReceiptStep
                number="03"
                label="Save record"
                value={
                  photo?.lastError && state === 'confirmed'
                    ? 'Recheck needed'
                    : recordWorking
                      ? 'Checking…'
                      : recordKnown
                        ? 'Verified'
                        : state === 'pending'
                          ? 'Unconfirmed'
                          : 'Not saved'
                }
                tone={
                  photo?.lastError && state === 'confirmed'
                    ? 'uncertain'
                    : recordWorking
                      ? 'working'
                      : recordKnown
                        ? 'done'
                        : state === 'pending'
                          ? 'uncertain'
                          : 'idle'
                }
                testID="receipt-record"
                largeText={largeText}
              />
            </View>
            {photo && <AccountTotals counts={counts} />}
          </View>
        )}
        {!!message && !message.startsWith('Cloud save is unconfirmed') && (
          <Text testID="operation-message" accessibilityLiveRegion="polite" style={s.error}>
            {message}
          </Text>
        )}
        <View style={s.mainAction}>
          {!photo ? (
            <Button
              primary
              testID="start-demo"
              label={
                busy
                  ? 'Preparing photo…'
                  : scenario?.id === 'normal' || scenario?.id === 'upload-response-lost'
                    ? 'Try interrupted save'
                    : 'Try this failure'
              }
              disabled={busy}
              onPress={() => {
                runtime.faults.select(
                  runtime.faults.scenario === 'normal'
                    ? 'upload-response-lost'
                    : runtime.faults.scenario,
                );
                onCapture('sample');
              }}
            />
          ) : saved ? (
            <Button
              primary
              testID="new-photo"
              label="Add another photo"
              disabled={busy}
              onPress={() => setSources(!sources)}
            />
          ) : state === 'deleted' ? (
            photo.deleteConfirmed ? (
              <Button
                primary
                testID="new-photo"
                label="Add another photo"
                disabled={busy}
                onPress={() => setSources(!sources)}
              />
            ) : (
              <Button
                primary
                testID="remove-photo"
                label={busy ? 'Checking removal…' : 'Retry cloud removal'}
                disabled={busy}
                onPress={onRemove}
              />
            )
          ) : (
            <Button
              primary
              testID="save-photo"
              label={
                busy
                  ? 'Checking this capture…'
                  : state === 'pending'
                    ? 'Retry save'
                    : state === 'confirmed'
                      ? 'Retry verification'
                      : 'Save photo'
              }
              disabled={busy}
              onPress={onSave}
            />
          )}
          {!saved && !(state === 'deleted' && photo?.deleteConfirmed) && (
            <Disclosure
              label={!photo ? 'Choose a photo' : 'Choose another photo'}
              open={sources}
              testID="new-photo"
              disabled={busy}
              onPress={() => setSources(!sources)}
            />
          )}
          {photoSources}
        </View>
        <View style={s.utilities}>
          <Disclosure
            label="Test scenario"
            value={scenario?.label}
            testID="toggle-failures"
            open={testing}
            disabled={busy}
            onPress={() => setTesting(!testing)}
          />
          {testing && (
            <View style={s.reveal}>
              <Text style={s.copy}>Inject one failure into the next save.</Text>
              {SCENARIOS.map((item) => (
                <FocusPressable
                  key={item.id}
                  accessibilityRole={Platform.OS === 'web' ? 'radio' : 'button'}
                  accessibilityLabel={item.label}
                  accessibilityState={{
                    checked: runtime.faults.scenario === item.id,
                    selected: runtime.faults.scenario === item.id,
                    disabled: busy,
                  }}
                  testID={`scenario-${item.id}`}
                  disabled={busy}
                  onPress={() => {
                    runtime.faults.select(item.id);
                    setTesting(false);
                  }}
                  style={({ pressed }) => [s.choice, pressed && { backgroundColor: c.greenWash }]}
                >
                  <Text style={s.choiceText}>{item.label}</Text>
                  <Text accessible={false} style={s.choiceMark}>
                    {runtime.faults.scenario === item.id ? '●' : '○'}
                  </Text>
                </FocusPressable>
              ))}
            </View>
          )}
          {photos.length > 1 && (
            <Disclosure
              label={`Photos (${photos.length})`}
              testID="toggle-photos"
              open={allPhotos}
              disabled={busy}
              onPress={() => setAllPhotos(!allPhotos)}
            />
          )}
          {allPhotos && (
            <View style={s.reveal}>
              {photos.map((p, index) => (
                <FocusPressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Photo ${photos.length - index}, ${stateLabel(p)}`}
                  accessibilityState={{ selected: p.id === photo?.id, disabled: busy }}
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
                </FocusPressable>
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
              {(!photo || state === 'deleted') && <AccountTotals counts={counts} />}
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
                <Text style={s.small}>
                  {photo.id} · {Math.ceil(photo.byteLength / 1024)} KB · JPEG
                </Text>
              )}
              <Text style={s.small}>
                <Text testID="deleted-count">{counts.deleted}</Text> deletion{' '}
                {counts.deleted === 1 ? 'record' : 'records'}
              </Text>
              {runtime.faults.offline && (
                <Text testID="network-status" style={s.error}>
                  Injected interruption. Retry resumes requests.
                </Text>
              )}
              {[...latest.values()].map((t) => (
                <View key={t.stage} style={s.traceRow}>
                  <Text
                    style={[
                      s.traceMark,
                      { color: t.outcome === 'unconfirmed' ? c.warning : c.green },
                    ]}
                  >
                    {t.outcome === 'ok' ? '✓' : t.outcome === 'unconfirmed' ? '!' : '·'}
                  </Text>
                  <Text style={s.copy}>{t.stage}</Text>
                </View>
              ))}
              {saved && (
                <Button
                  testID="save-photo"
                  label={busy ? 'Checking this capture…' : 'Verify again'}
                  disabled={busy}
                  onPress={onSave}
                />
              )}
              {photo && state !== 'deleted' && (
                <View style={s.removal}>
                  <Button
                    testID="remove-photo"
                    label="Remove photo"
                    danger
                    disabled={busy}
                    onPress={onRemove}
                  />
                  <Text style={s.small}>
                    Soft removal. Local and cloud image files are retained.
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
        <Text style={s.footer}>An Expo starter by AutonoMax Innovations</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  page: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 28,
  },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  loadingTitle: { color: c.ink, fontSize: 22, fontWeight: '600' },
  header: { marginBottom: 28, gap: 5 },
  brand: { fontSize: 18, lineHeight: 24, fontWeight: '600', letterSpacing: -0.5, color: c.ink },
  mode: { fontSize: 12, lineHeight: 18, color: c.muted },
  story: { gap: 9, marginBottom: 20 },
  eyebrow: {
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: 1.25,
    textTransform: 'uppercase',
  },
  title: { fontSize: 34, lineHeight: 39, fontWeight: '700', letterSpacing: -1.1, color: c.ink },
  help: { fontSize: 14, lineHeight: 21, color: c.muted, maxWidth: 365 },
  preview: {
    width: '100%',
    aspectRatio: 1.9,
    backgroundColor: c.greenWash,
    borderRadius: 14,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: { width: '100%', height: '100%' },
  sampleCaption: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 5,
    backgroundColor: '#ffffffee',
  },
  sampleCaptionText: { color: c.ink, fontSize: 11, lineHeight: 16 },
  empty: { alignItems: 'center', gap: 9, padding: 20 },
  emptyTitle: { fontSize: 18, lineHeight: 24, fontWeight: '600', color: c.ink },
  receipt: {
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingTop: 13,
    paddingBottom: 12,
    marginTop: 16,
  },
  receiptHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 13,
    flexWrap: 'wrap',
  },
  receiptTitle: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: c.muted,
  },
  captureId: {
    fontSize: 11,
    lineHeight: 16,
    color: c.muted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  receiptSteps: { flexDirection: 'row', gap: 8 },
  receiptStepsLarge: { flexDirection: 'column', gap: 18 },
  receiptStep: { flex: 1, alignItems: 'flex-start', gap: 4 },
  receiptStepLarge: { flex: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepCopy: { gap: 4, flexShrink: 1, alignSelf: 'stretch' },
  stepMark: {
    width: 29,
    height: 29,
    borderRadius: 15,
    backgroundColor: '#f0f3ef',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  stepDone: { backgroundColor: c.greenWash },
  stepUncertain: { backgroundColor: c.warningWash },
  stepNumber: { fontSize: 10, fontWeight: '700' },
  stepLabel: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: c.ink },
  stepValue: { fontSize: 12, lineHeight: 18 },
  totals: {
    borderTopWidth: 1,
    borderTopColor: c.line,
    marginTop: 13,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    flexWrap: 'wrap',
  },
  totalsValue: { fontSize: 12, lineHeight: 18, fontWeight: '500', color: c.ink },
  mainAction: { marginTop: 18 },
  button: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  primary: { minHeight: 54, backgroundColor: c.green },
  buttonText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: c.ink,
    textAlign: 'center',
  },
  sources: { paddingTop: 6, paddingBottom: 10, backgroundColor: c.greenWash, borderRadius: 11 },
  sourceRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, flexWrap: 'wrap' },
  utilities: { marginTop: 8 },
  disclosure: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 2,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  disclosureLabel: { flex: 1, gap: 2 },
  disclosureText: { fontSize: 13, lineHeight: 20, fontWeight: '500', color: c.ink },
  chevron: { fontSize: 19, lineHeight: 23, color: c.muted },
  reveal: { paddingBottom: 12, paddingHorizontal: 2, gap: 8 },
  choice: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 7,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  choiceText: { flex: 1, fontSize: 14, lineHeight: 21, color: c.ink },
  choiceMark: { fontSize: 17, color: c.green },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  copy: { fontSize: 14, lineHeight: 21, color: c.muted },
  small: { fontSize: 12, lineHeight: 18, color: c.muted },
  error: { fontSize: 13, lineHeight: 20, color: c.warning, marginTop: 12 },
  traceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  traceMark: { width: 14, fontSize: 15 },
  removal: { marginTop: 10, alignItems: 'flex-start', gap: 4 },
  footer: { fontSize: 11, lineHeight: 17, color: c.muted, marginTop: 22, textAlign: 'center' },
});
