import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { previewPhoto, releasePreview } from '../adapters/files';
import { SCENARIOS } from '../adapters/faults';
import { DEMO_A } from '../adapters/demo';
import type { Photo, Trace } from '../core/types';
import type { Runtime } from '../runtime';

const c = {
  ink: '#171719',
  muted: '#717178',
  section: '#57575e',
  line: '#e1e1e6',
  fill: '#f3f3f5',
  white: '#ffffff',
  blue: '#006be6',
  warning: '#956514',
  danger: '#b1362f',
};
type Props = {
  runtime: Runtime | undefined;
  initialError: string;
  photo: Photo | undefined;
  photos: Photo[];
  counts: { objects: number; rows: number; deleted: number } | null;
  traces: Trace[];
  busy: boolean;
  activity: 'capture' | 'save' | 'remove' | undefined;
  message: string;
  onCapture: (source: 'sample' | 'library' | 'camera') => void;
  onSave: (id: string) => void;
  onRemove: (id: string) => void;
  onSwitch: () => void;
  onSelect: (id: string) => void;
};
type LocalRead = { owner: string; localUri: string; available: boolean };

function Icon({
  name,
  size = 20,
  color = c.muted,
}: {
  name: IoniconsIconName;
  size?: number;
  color?: string;
}) {
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      allowFontScaling={false}
    />
  );
}
function FocusPressable({
  style,
  onFocus,
  onBlur,
  ...props
}: React.ComponentProps<typeof Pressable>) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...props}
      onFocus={(event) => {
        const target = event.target as unknown as { matches?: (selector: string) => boolean };
        setFocused(Platform.OS !== 'web' || target.matches?.(':focus-visible') === true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={(state) => [
        typeof style === 'function' ? style(state) : style,
        focused && { borderColor: c.blue },
      ]}
    />
  );
}
function TextButton({
  label,
  testID,
  onPress,
  disabled = false,
  icon,
  danger = false,
  compact = false,
}: {
  label: string;
  testID?: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: IoniconsIconName;
  danger?: boolean;
  compact?: boolean;
}) {
  const color = disabled ? c.muted : danger ? c.danger : c.blue;
  return (
    <FocusPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.textButton, pressed && s.pressed]}
    >
      {icon && <Icon name={icon} size={23} color={color} />}
      <Text style={[s.actionText, compact && s.compactAction, { color }]}>{label}</Text>
    </FocusPressable>
  );
}
function SaveButton({
  label,
  onPress,
  disabled,
  removal = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  removal?: boolean;
  testID?: string;
}) {
  return (
    <FocusPressable
      testID={testID ?? (removal ? 'remove-photo' : 'save-photo')}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.saveTarget, pressed && s.pressed]}
    >
      <View style={[s.saveButton, disabled && { backgroundColor: '#9f9fa4' }]}>
        <Text style={s.saveText}>{label}</Text>
      </View>
    </FocusPressable>
  );
}

// Every thumbnail reads and decodes the original. Journal presence alone cannot prove it is kept.
function PhotoImage({
  photo,
  onRead,
  expanded = false,
}: {
  photo: Photo;
  onRead: (read: Omit<LocalRead, 'owner'>) => void;
  expanded?: boolean;
}) {
  const [uri, setUri] = useState<string>();
  const [failed, setFailed] = useState(false);
  const removed = photo.state === 'deleted';
  useEffect(() => {
    let active = true,
      loaded: string | undefined;
    setUri(undefined);
    setFailed(false);
    if (!removed)
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
  }, [photo.localUri, removed, onRead]);
  return (
    <View style={expanded ? s.expandedImage : s.thumbnail}>
      {uri && !failed && !removed ? (
        <Image
          source={{ uri }}
          style={s.image}
          resizeMode={expanded ? 'contain' : 'cover'}
          accessibilityLabel={expanded ? 'Photo preview' : 'Photo thumbnail'}
          onLoad={() => onRead({ localUri: photo.localUri, available: true })}
          onError={() => {
            setFailed(true);
            onRead({ localUri: photo.localUri, available: false });
          }}
        />
      ) : !removed && !failed ? (
        <ActivityIndicator color={c.muted} size="small" accessibilityLabel="Loading photo" />
      ) : (
        <View style={s.imageUnavailable}>
          <Icon name={removed ? 'trash-outline' : 'image-outline'} size={expanded ? 28 : 23} />
          {expanded && (
            <Text style={s.copy}>{removed ? 'Photo removed' : 'Preview unavailable'}</Text>
          )}
        </View>
      )}
    </View>
  );
}
const statusOf = (p: Photo) =>
  p.state === 'confirmed'
    ? p.lastError
      ? 'Verification unconfirmed'
      : 'Saved'
    : p.state === 'pending'
      ? 'Save unconfirmed'
      : p.state === 'deleted'
        ? p.deleteConfirmed
          ? 'Removal confirmed'
          : 'Removed locally'
        : 'Ready to save';
function metadata(p: Photo, primary: boolean) {
  const date = new Date(p.createdAt),
    today = new Date(),
    yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const day =
    date.toDateString() === today.toDateString()
      ? primary
        ? ''
        : 'Today, '
      : date.toDateString() === yesterday.toDateString()
        ? 'Yesterday, '
        : `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, `;
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day}${time} · ${Math.ceil(p.byteLength / 1024)} KB`;
}
function Status({
  photo,
  working = false,
  primary = false,
  removal = false,
}: {
  photo: Photo;
  working?: boolean;
  primary?: boolean;
  removal?: boolean;
}) {
  const uncertain =
    photo.state === 'pending' ||
    !!photo.lastError ||
    (photo.state === 'deleted' && !photo.deleteConfirmed);
  const done =
    (photo.state === 'confirmed' && !photo.lastError) ||
    (photo.state === 'deleted' && photo.deleteConfirmed);
  return (
    <View style={s.statusLine} accessibilityLiveRegion={primary ? 'polite' : undefined}>
      {working ? (
        <ActivityIndicator color={c.muted} size="small" />
      ) : uncertain ? (
        <Icon name="alert-circle" size={19} color={c.warning} />
      ) : done ? (
        <Icon name="checkmark-circle" size={19} />
      ) : null}
      <Text
        testID={primary ? 'photo-status' : undefined}
        style={[s.status, uncertain && !working && { color: c.warning }]}
      >
        {working ? (removal ? 'Checking removal…' : 'Checking cloud…') : statusOf(photo)}
      </Text>
    </View>
  );
}
function AccountTotals({ counts }: { counts: Props['counts'] }) {
  if (!counts)
    return (
      <View testID="cloud-summary" style={s.inspectorBlock}>
        <Text style={s.inspectorLabel}>Account totals</Text>
        <Text testID="cloud-counts-unavailable" style={s.small}>
          Cloud totals unavailable. Retry checks this capture.
        </Text>
      </View>
    );
  return (
    <View testID="cloud-summary" style={s.inspectorBlock}>
      <Text style={s.inspectorLabel}>Account totals</Text>
      <Text style={s.copy}>
        <Text testID="object-count">{counts.objects}</Text>{' '}
        {counts.objects === 1 ? 'image' : 'images'} · <Text testID="row-count">{counts.rows}</Text>{' '}
        saved {counts.rows === 1 ? 'record' : 'records'}
      </Text>
      <Text style={s.small}>
        <Text testID="deleted-count">{counts.deleted}</Text> deletion{' '}
        {counts.deleted === 1 ? 'record' : 'records'}
      </Text>
    </View>
  );
}
function ReceiptRow({
  label,
  value,
  known,
  working,
  testID,
}: {
  label: string;
  value: string;
  known: boolean;
  working?: boolean;
  testID: string;
}) {
  return (
    <View testID={testID} style={s.receiptRow} accessible accessibilityLabel={`${label}: ${value}`}>
      {working ? (
        <ActivityIndicator size="small" color={c.muted} />
      ) : (
        <Icon name={known ? 'checkmark-circle' : 'ellipse-outline'} />
      )}
      <View style={s.receiptCopy}>
        <Text style={s.copy}>{label}</Text>
        <Text style={s.small}>{value}</Text>
      </View>
    </View>
  );
}

export function PhotoScreen({
  runtime,
  initialError,
  photo,
  photos,
  counts,
  traces,
  busy,
  activity,
  message,
  onCapture,
  onSave,
  onRemove,
  onSwitch,
  onSelect,
}: Props) {
  const [sheet, setSheet] = useState<'sources' | 'details' | 'tests'>();
  const [reads, setReads] = useState<Record<string, boolean>>({});
  const owner = runtime?.owner() ?? '';
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const list = useRef<FlatList<Photo>>(null);
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 350 || fontScale >= 1.4;
  // Ignore late image callbacks from another account; release each object URL in PhotoImage.
  const onRead = useCallback(
    (read: Omit<LocalRead, 'owner'>) => {
      if (currentOwner.current !== owner) return;
      setReads((old) =>
        old[read.localUri] === read.available ? old : { ...old, [read.localUri]: read.available },
      );
    },
    [owner],
  );
  useEffect(() => {
    setSheet(undefined);
    setReads({});
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [owner]);
  const status = photo ? statusOf(photo) : '';
  useEffect(() => {
    if (Platform.OS === 'ios' && photo) AccessibilityInfo.announceForAccessibility(status);
  }, [photo?.id, status]);
  const latest = new Map<string, Trace>();
  traces.filter((t) => t.photoId === photo?.id).forEach((t) => latest.set(t.stage, t));
  const saved = photo?.state === 'confirmed' && !photo.lastError;
  const working = busy && activity !== 'capture';
  const imageKnown = saved || latest.get('Verify readable image')?.outcome === 'ok';
  const recordKnown = saved || latest.get('Save database record')?.outcome === 'ok';
  const currentTrace = traces.filter((t) => t.photoId === photo?.id).at(-1);
  const imageWorking =
    working &&
    currentTrace?.outcome === 'working' &&
    ['Check stored image', 'Upload image', 'Verify readable image'].includes(currentTrace.stage);
  const recordWorking = working && latest.get('Save database record')?.outcome === 'working';
  const missing =
    !!photo &&
    (reads[photo.localUri] === false || !!photo.lastError?.startsWith('The original JPEG'));
  const localReadable = !!photo && reads[photo.localUri] === true && !missing;
  const scenario = SCENARIOS.find((item) => item.id === runtime?.faults.scenario);
  if (!runtime)
    return (
      <SafeAreaView style={[s.root, s.loading]}>
        {initialError ? (
          <>
            <Text style={s.sectionTitle}>Could not open recovery</Text>
            <Text style={s.error}>{initialError}</Text>
          </>
        ) : (
          <>
            <ActivityIndicator color={c.muted} />
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
      : `Account ${owner.slice(0, 6)}`;
  const titleOf = (p: Photo) =>
    `Photo ${photos.length - photos.findIndex((item) => item.id === p.id)}`;
  const groupTitle = !photo
    ? ''
    : working
      ? activity === 'remove'
        ? 'Removing'
        : 'Recovering'
      : photo.state === 'pending' || (photo.state === 'confirmed' && photo.lastError)
        ? 'Needs retry'
        : photo.state === 'local'
          ? 'Ready to save'
          : photo.state === 'deleted'
            ? photo.deleteConfirmed
              ? 'Removed capture'
              : 'Needs removal'
            : 'Latest capture';
  const help = !photo
    ? ''
    : photo.state === 'deleted'
      ? 'Soft removal. Image files are retained.'
      : saved
        ? 'Image and save record verified.'
        : missing
          ? 'Local original unavailable. Check Details.'
          : !localReadable
            ? 'Checking the local copy…'
            : working
              ? 'Local copy kept. Checking this capture.'
              : photo.state === 'pending' || photo.lastError
                ? 'Local copy kept. Retry checks the cloud.'
                : 'Local copy kept. Ready when you are.';
  const openPhoto = (p: Photo) => {
    onSelect(p.id);
    setSheet('details');
  };
  const capture = (source: 'sample' | 'library' | 'camera') => {
    setSheet(undefined);
    onCapture(source);
  };
  const saveAction = (p: Photo, detail = false) => {
    if (p.state === 'deleted')
      return (
        !p.deleteConfirmed && (
          <SaveButton
            label={working ? 'Retrying' : 'Retry removal'}
            disabled={busy}
            removal
            testID={detail ? 'details-remove-photo' : undefined}
            onPress={() => onRemove(p.id)}
          />
        )
      );
    if (p.state === 'confirmed' && !p.lastError) return null;
    return (
      <SaveButton
        testID={detail ? 'details-save-photo' : undefined}
        label={working ? 'Retrying' : p.state === 'local' ? 'Save' : 'Retry'}
        disabled={busy}
        onPress={() => onSave(p.id)}
      />
    );
  };
  const row = (p: Photo, primary: boolean) => {
    const hasAction =
      primary &&
      !(p.state === 'confirmed' && !p.lastError) &&
      !(p.state === 'deleted' && p.deleteConfirmed);
    return (
      <View
        testID={primary ? 'active-photo' : undefined}
        nativeID={primary ? p.id : undefined}
        style={[s.photoRow, primary && stacked && s.stackedRow]}
      >
        <FocusPressable
          testID={`capture-${p.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${titleOf(p)}, ${statusOf(p)}. View photo and save details.`}
          accessibilityState={{ disabled: busy && !primary }}
          disabled={busy && !primary}
          onPress={() => openPhoto(p)}
          style={({ pressed }) => [s.rowOpen, pressed && s.pressed]}
        >
          <PhotoImage photo={p} onRead={onRead} />
          <View style={s.rowCopy}>
            <Text style={s.photoTitle}>{titleOf(p)}</Text>
            <Text style={s.metadata}>{metadata(p, primary)}</Text>
            <Status
              photo={p}
              working={primary && working}
              primary={primary}
              removal={activity === 'remove'}
            />
          </View>
          {!hasAction && (
            <Icon name="chevron-forward" size={21} color={busy ? '#c2c2c8' : '#9999a1'} />
          )}
        </FocusPressable>
        {hasAction && saveAction(p)}
      </View>
    );
  };
  const others = photos.filter((p) => p.id !== photo?.id);
  return (
    <SafeAreaView style={s.root}>
      <View
        style={s.root}
        accessibilityElementsHidden={!!sheet}
        importantForAccessibility={sheet ? 'no-hide-descendants' : 'auto'}
        aria-hidden={!!sheet}
      >
        <FlatList
          ref={list}
          data={others}
          keyExtractor={(p) => p.id}
          style={s.list}
          contentContainerStyle={s.page}
          ListFooterComponentStyle={s.listFooter}
          renderItem={({ item }) => <View style={s.recentRow}>{row(item, false)}</View>}
          ListHeaderComponent={
            <>
              <View style={s.header}>
                <View style={[s.headingRow, fontScale >= 1.4 && { flexWrap: 'wrap' }]}>
                  <Text accessibilityRole="header" maxFontSizeMultiplier={1.6} style={s.title}>
                    Outbox
                  </Text>
                  <TextButton
                    label="Add photo"
                    testID="new-photo"
                    icon="add"
                    disabled={busy}
                    onPress={() => setSheet('sources')}
                  />
                </View>
                <Text style={s.mode}>
                  {runtime.mode === 'demo' ? 'Demo · simulated cloud' : 'Supabase'}
                </Text>
              </View>
              {!photo ? (
                <View style={s.empty}>
                  <Text testID="no-capture" style={s.emptyTitle}>
                    No photos yet
                  </Text>
                  <Text style={s.copy}>Choose a photo to start a save.</Text>
                  <TextButton
                    label={busy ? 'Preparing photo…' : 'Try recovery demo'}
                    compact
                    testID="start-demo"
                    disabled={busy}
                    onPress={() => {
                      runtime.faults.select(
                        runtime.faults.scenario === 'normal'
                          ? 'upload-response-lost'
                          : runtime.faults.scenario,
                      );
                      capture('sample');
                    }}
                  />
                </View>
              ) : (
                <View style={s.primaryGroup}>
                  <Text accessibilityRole="header" style={[s.sectionTitle, { marginBottom: 6 }]}>
                    {groupTitle}
                  </Text>
                  {row(photo, true)}
                  <View
                    style={[
                      s.rowFooter,
                      stacked && { flexDirection: 'column', alignItems: 'flex-start' },
                    ]}
                  >
                    <Text style={[s.rowHelp, stacked && { flex: 0, alignSelf: 'stretch' }]}>
                      {help}
                    </Text>
                    <TextButton
                      label="Details"
                      compact
                      testID="toggle-details"
                      onPress={() => setSheet('details')}
                    />
                  </View>
                </View>
              )}
              {!!message && !message.startsWith('Cloud save is unconfirmed') && (
                <Text testID="operation-message" accessibilityLiveRegion="polite" style={s.error}>
                  {message}
                </Text>
              )}
              {others.length > 0 && (
                <Text accessibilityRole="header" style={[s.sectionTitle, s.recentTitle]}>
                  Recent captures
                </Text>
              )}
            </>
          }
          ListFooterComponent={
            <View style={s.footerContent}>
              {photos.length > 0 && (
                <Text style={s.listHint}>Tap a photo to view its preview and save details.</Text>
              )}
              <View style={s.testFooter}>
                <FocusPressable
                  testID="toggle-failures"
                  accessibilityRole="button"
                  accessibilityLabel={`Test controls: ${scenario?.label}`}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => setSheet('tests')}
                  style={({ pressed }) => [
                    s.testControl,
                    pressed && s.pressed,
                    busy && { opacity: 0.5 },
                  ]}
                >
                  <Icon name="settings-outline" size={28} color={c.section} />
                  <View style={s.testCopy}>
                    <Text style={s.photoTitle}>Test controls</Text>
                    <Text testID="scenario-hint" style={s.metadata}>
                      {scenario?.label}
                    </Text>
                  </View>
                  <Icon name="chevron-forward" size={21} color="#9999a1" />
                </FocusPressable>
              </View>
            </View>
          }
        />
      </View>
      <Modal
        visible={!!sheet}
        transparent
        animationType={Platform.OS === 'web' ? 'none' : 'slide'}
        onRequestClose={() => setSheet(undefined)}
      >
        <View style={s.modalRoot}>
          <Pressable
            accessible={false}
            focusable={false}
            tabIndex={-1}
            aria-hidden
            onPress={() => setSheet(undefined)}
            style={s.backdrop}
          />
          <SafeAreaView edges={['bottom']} style={s.sheet} accessibilityViewIsModal>
            <View style={s.sheetHeader}>
              <Text accessibilityRole="header" maxFontSizeMultiplier={1.6} style={s.sheetTitle}>
                {sheet === 'sources'
                  ? 'Add photo'
                  : sheet === 'tests'
                    ? 'Test controls'
                    : photo
                      ? titleOf(photo)
                      : 'Details'}
              </Text>
              <TextButton label="Done" testID="close-panel" onPress={() => setSheet(undefined)} />
            </View>
            <ScrollView contentContainerStyle={s.sheetContent}>
              {sheet === 'sources' && (
                <>
                  <Text style={s.copy}>
                    Choose a photo. Its JPEG is kept locally before the cloud save.
                  </Text>
                  {(
                    [
                      ['library', 'Photo library', 'images-outline'],
                      ['camera', 'Camera', 'camera-outline'],
                      ['sample', 'Use sample photo', 'image-outline'],
                    ] as const
                  ).map(([source, label, icon]) => (
                    <FocusPressable
                      key={source}
                      testID={source === 'sample' ? 'sample-photo' : `${source}-photo`}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      disabled={busy}
                      onPress={() => capture(source)}
                      style={s.sheetChoice}
                    >
                      <Icon name={icon} color={c.blue} />
                      <Text style={s.choiceText}>{label}</Text>
                      <Icon name="chevron-forward" size={18} />
                    </FocusPressable>
                  ))}
                  <Text style={s.small}>The coastline sample is AI generated.</Text>
                </>
              )}
              {sheet === 'tests' && (
                <>
                  <Text style={s.copy}>Inject one failure into the next save.</Text>
                  {SCENARIOS.map((item) => (
                    <FocusPressable
                      key={item.id}
                      testID={`scenario-${item.id}`}
                      accessibilityRole={Platform.OS === 'web' ? 'radio' : 'button'}
                      accessibilityLabel={item.label}
                      aria-checked={
                        Platform.OS === 'web' ? runtime.faults.scenario === item.id : undefined
                      }
                      accessibilityState={{
                        checked: runtime.faults.scenario === item.id,
                        selected: runtime.faults.scenario === item.id,
                        disabled: busy,
                      }}
                      disabled={busy}
                      onPress={() => {
                        runtime.faults.select(item.id);
                        setSheet(undefined);
                      }}
                      style={s.sheetChoice}
                    >
                      <Text style={s.choiceText}>{item.label}</Text>
                      <Icon
                        name={
                          runtime.faults.scenario === item.id
                            ? 'checkmark-circle'
                            : 'ellipse-outline'
                        }
                        color={runtime.faults.scenario === item.id ? c.blue : c.muted}
                      />
                    </FocusPressable>
                  ))}
                  <AccountTotals counts={counts} />
                  <View style={s.inspectorBlock}>
                    <Text testID="account-label" style={s.inspectorLabel}>
                      {ownerLabel}
                    </Text>
                    <TextButton
                      label={runtime.mode === 'demo' ? 'Switch account' : 'New test account'}
                      testID="switch-account"
                      onPress={onSwitch}
                    />
                    <Text style={s.small}>
                      {runtime.mode === 'demo'
                        ? 'Each demo account has a separate outbox.'
                        : 'A new anonymous account cannot reopen the previous account’s photos.'}
                    </Text>
                  </View>
                  <Text style={s.small}>Expo + Supabase starter by AutonoMax Innovations.</Text>
                </>
              )}
              {sheet === 'details' && photo && (
                <>
                  <PhotoImage key={photo.id} photo={photo} expanded onRead={onRead} />
                  <View style={s.detailHeading}>
                    <Status photo={photo} working={working} removal={activity === 'remove'} />
                    <Text style={s.metadata}>{metadata(photo, false)} · JPEG</Text>
                  </View>
                  <Text style={s.inspectorLabel}>Capture ID</Text>
                  <Text selectable testID="capture-id" style={s.captureId}>
                    {photo.id}
                  </Text>
                  {photo.state !== 'deleted' && (
                    <View testID="save-receipt" style={s.inspectorBlock}>
                      <Text style={s.inspectorLabel}>This capture</Text>
                      <ReceiptRow
                        testID="receipt-device"
                        label="On device"
                        value={missing ? 'Unavailable' : localReadable ? 'Kept' : 'Loading…'}
                        known={localReadable}
                        working={!missing && !localReadable}
                      />
                      <ReceiptRow
                        testID="receipt-image"
                        label="Cloud image"
                        value={
                          photo.state === 'confirmed' && photo.lastError
                            ? 'Recheck needed'
                            : imageWorking
                              ? 'Checking…'
                              : imageKnown
                                ? 'Verified'
                                : photo.state === 'pending'
                                  ? 'Unconfirmed'
                                  : 'Not sent'
                        }
                        known={imageKnown && !(photo.state === 'confirmed' && photo.lastError)}
                        working={imageWorking}
                      />
                      <ReceiptRow
                        testID="receipt-record"
                        label="Save record"
                        value={
                          photo.state === 'confirmed' && photo.lastError
                            ? 'Recheck needed'
                            : recordWorking
                              ? 'Checking…'
                              : recordKnown
                                ? 'Verified'
                                : photo.state === 'pending'
                                  ? 'Unconfirmed'
                                  : 'Not saved'
                        }
                        known={recordKnown && !(photo.state === 'confirmed' && photo.lastError)}
                        working={recordWorking}
                      />
                    </View>
                  )}
                  {missing && (
                    <Text style={s.error}>
                      The original JPEG is unavailable. Save checks the cloud; no replacement photo
                      is uploaded.
                    </Text>
                  )}
                  {!!photo.lastError && localReadable && (
                    <Text style={s.small}>{photo.lastError}</Text>
                  )}
                  {runtime.faults.offline && (
                    <Text testID="network-status" style={s.small}>
                      Injected interruption. Retry resumes requests.
                    </Text>
                  )}
                  {[...latest.values()].map((t) => (
                    <View key={t.stage} style={s.traceRow}>
                      <Icon
                        name={
                          t.outcome === 'ok'
                            ? 'checkmark'
                            : t.outcome === 'unconfirmed'
                              ? 'alert-circle-outline'
                              : 'time-outline'
                        }
                        size={17}
                        color={t.outcome === 'unconfirmed' ? c.warning : c.muted}
                      />
                      <Text style={s.small}>{t.stage}</Text>
                    </View>
                  ))}
                  <View style={s.detailActions}>
                    {saved ? (
                      <TextButton
                        label={working ? 'Checking…' : 'Verify again'}
                        testID="details-save-photo"
                        disabled={busy}
                        onPress={() => onSave(photo.id)}
                      />
                    ) : (
                      saveAction(photo, true)
                    )}
                    {photo.state !== 'deleted' && (
                      <TextButton
                        label="Remove photo"
                        testID="details-remove-photo"
                        danger
                        disabled={busy}
                        onPress={() => onRemove(photo.id)}
                      />
                    )}
                  </View>
                  <Text style={s.small}>
                    Soft removal. Local and cloud image files are retained.
                  </Text>
                  <AccountTotals counts={counts} />
                  <View style={s.inspectorBlock}>
                    <Text testID="account-label" style={s.inspectorLabel}>
                      {ownerLabel}
                    </Text>
                    <TextButton
                      label={runtime.mode === 'demo' ? 'Switch account' : 'New test account'}
                      testID="switch-account"
                      onPress={onSwitch}
                    />
                  </View>
                </>
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.white },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  list: { flex: 1 },
  page: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'web' ? 36 : 16,
    paddingBottom: 30,
  },
  header: { marginBottom: 28 },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: { fontSize: 34, lineHeight: 42, fontWeight: '700', letterSpacing: -1.1, color: c.ink },
  mode: { fontSize: 14, lineHeight: 20, color: c.muted, marginTop: 3 },
  textButton: {
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexShrink: 0,
  },
  actionText: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  compactAction: { fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.65 },
  sectionTitle: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: c.section },
  primaryGroup: { gap: 0 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  stackedRow: { flexDirection: 'column', alignItems: 'stretch' },
  rowOpen: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 5,
    minHeight: 76,
    paddingVertical: 4,
  },
  rowCopy: { flex: 1, gap: 2 },
  thumbnail: {
    width: 64,
    height: 66,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: c.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  photoTitle: { fontSize: 16, lineHeight: 22, fontWeight: '400', color: c.ink },
  metadata: { fontSize: 13, lineHeight: 19, color: c.muted },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { fontSize: 14, lineHeight: 20, color: c.muted, flexShrink: 1 },
  saveTarget: {
    minHeight: 44,
    minWidth: 78,
    paddingVertical: 4,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 9,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    borderRadius: 7,
    minHeight: 35,
    minWidth: 74,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#252527',
  },
  saveText: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: c.white },
  rowFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 3,
  },
  rowHelp: { flex: 1, fontSize: 13, lineHeight: 20, color: c.muted },
  recentTitle: { marginTop: 16, marginBottom: 6 },
  recentRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
    paddingVertical: 3,
  },
  listFooter: { flexGrow: 1 },
  footerContent: { flex: 1 },
  listHint: { fontSize: 13, lineHeight: 20, color: c.muted, marginTop: 18 },
  testFooter: { marginTop: 'auto', paddingTop: 30 },
  testControl: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    paddingTop: 16,
    paddingBottom: 4,
    minHeight: 68,
  },
  testCopy: { flex: 1, gap: 2 },
  empty: { alignItems: 'flex-start', gap: 5 },
  emptyTitle: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: c.ink },
  copy: { fontSize: 14, lineHeight: 21, color: c.muted },
  small: { fontSize: 12, lineHeight: 19, color: c.muted },
  error: { fontSize: 13, lineHeight: 20, color: c.warning, marginTop: 10 },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#00000030',
  },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '90%',
    backgroundColor: c.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  sheetTitle: { flex: 1, fontSize: 18, lineHeight: 26, fontWeight: '600', color: c.ink },
  sheetContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28, gap: 12 },
  sheetChoice: {
    minHeight: 52,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  choiceText: { flex: 1, fontSize: 15, lineHeight: 22, color: c.ink },
  expandedImage: {
    height: 190,
    width: '100%',
    backgroundColor: c.fill,
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageUnavailable: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  detailHeading: { gap: 6 },
  inspectorBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    paddingTop: 16,
    gap: 8,
  },
  inspectorLabel: { fontSize: 13, lineHeight: 20, fontWeight: '600', color: c.section },
  captureId: {
    fontSize: 12,
    lineHeight: 19,
    color: c.muted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  receiptRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 3 },
  receiptCopy: { flex: 1, gap: 1 },
  traceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailActions: {
    flexDirection: 'row',
    gap: 18,
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
});
