# Verification

Outbox verification on 2026-10-12. These layers establish different things; none establishes a hosted release or physical-device acceptance.

| Layer                                                  | Observed result               | What it checks                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                                             | Passed                        | App, UI, adapters, core, and test types                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Core                                                   | 39/39 passed                  | Partial saves, lost acknowledgements, restart, concurrent taps, missing/invalid files, account changes at remote stages, A/B/A generations, removal during upload, deletion fences, disk failures, and late commits after deadlines                                                                                                                                                                                                                             |
| PostgreSQL                                             | 10/10 passed                  | Actual migration in PGlite, owner RLS, immutable IDs, invalid/missing objects, create-only Storage, private paths, and permanent tombstones                                                                                                                                                                                                                                                                                                                     |
| Browser                                                | 15/15 passed                  | Six save/failure flows at 1280px, recovery at 390px and 320px, real reload/IndexedDB persistence, account isolation, removal, failed verification, older captures, missing JPEG bytes, and an original evicted after its upload committed. A held real image-readability request checks busy controls and readable Details. Keyboard checks cover import, scenario selection, retry, focus, and modal isolation. No uncaught exceptions or horizontal overflow. |
| iOS and Android Hermes exports                         | Passed                        | Native module resolution, icon assets, and bytecode bundles. This does not establish Android runtime behavior.                                                                                                                                                                                                                                                                                                                                                  |
| iOS Simulator, Expo Go 57.0.9 / iOS 26.5               | Passed                        | JPEG normalization, document-directory persistence, decoding, lost upload response, force-stop/relaunch, and one-action retry. Capture `9f53e4cd-1101-46f8-8f1e-bd6d20075a3a` stayed the same and became Saved. Before retry, Account B had three images and two ready records. After retry it had three images and three ready records; Photo 2 remains local.                                                                                                 |
| Android Emulator, Expo Go 57.0.9 / Android 16 (API 36) | Passed within the tested flow | All six save scenarios, two injected interruptions across force-stop/relaunch, a separate system-picker cold restart, emulated-camera import and permission denial, account isolation, native Back dismissal, and Save at 200% text size on a compact 320-point viewport. The labelled simulated cloud, JPEG files, and AsyncStorage journal ran on Android. See the detailed receipt below.                                                                    |
| Largest iOS accessibility text setting                 | Passed within the tested flow | Outbox remains scrollable; source choices, full capture ID, receipts, Save, and Done remain readable/reachable. Panel headings are capped like the Outbox heading; body/action text scales. Font preference was restored afterward. VoiceOver and physical-device acceptance remain separate.                                                                                                                                                                   |
| Local Supabase HTTP                                    | 9/9 passed, 2026-10-12        | Actual Auth, Storage, PostgREST, migration, signed downloads, retries, two-account isolation, deletion, and downloaded JPEG byte equality. The existing local integration suite was rerun against this starter's separate stack.                                                                                                                                                                                                                                |
| Android with real local Supabase and interrupted HTTP  | Passed after UI loading fix   | Normal save, dropped upload/database acknowledgements, sustained outage after either write, a rejected database request, and saving/reopening while the backend is unreachable. Eight synthetic captures ended with exactly eight real Storage images and eight ready database records.                                                                                                                                                                         |

The fault wrapper injects failures around actual adapter operations. A lost response commits the upload or record, discards the acknowledgement, and blocks subsequent controller requests until Retry resumes them. This is controlled failure injection, not a real cellular outage.

The video uses real browser interactions with the clearly labelled simulated cloud. Image persistence uses actual IndexedDB and AsyncStorage. It shows save, lost response, Details, reload, retry, and verification of the same capture with one image and one record. It is a browser demonstration of the shared Expo UI, not a recording of a physical phone or hosted Supabase.

## Android runtime receipt

Tested on 2026-10-12 in an isolated Pixel 8 Android 16/API 36 ARM64 emulator, `PhotoRecoveryQA_20261012` / `emulator-5556`, at 1080 × 2400 with density 420. Expo Go's installed version was 57.0.9. The existing SPORTTS emulator was left untouched. These checks used **Demo · simulated cloud**. They establish Android runtime behavior in Expo Go, not a standalone release binary, hosted Supabase, or a physical phone.

Each row below used a fresh capture in Account A. Totals are account totals; the selected capture's receipt was checked separately. Every retry preserved the capture ID and ended with both cloud receipts Verified.

| Scenario                                  | Totals before retry: images / ready records | Totals after recovery | Capture ID                             |
| ----------------------------------------- | ------------------------------------------- | --------------------- | -------------------------------------- |
| Lost upload response, force-stop/relaunch | 1 / 0                                       | 1 / 1                 | `706ef4f4-78b8-4957-9e78-596c14cef4ad` |
| Normal save                               | No retry required                           | 2 / 2                 | `4233ed26-87fb-4a3b-98e8-3df49f9a66ed` |
| Database rejects save                     | 3 / 2                                       | 3 / 3                 | `94c44378-5154-4860-8d4f-800a8e00436a` |
| Lost database response                    | 4 / 4, selected record still Unconfirmed    | 4 / 4                 | `3537d505-28c0-489b-8e35-4ff910b2c5d9` |
| Upload rejects save                       | 4 / 4                                       | 5 / 5                 | `44f9a7d5-f3d4-4266-a664-4a6717f11c36` |
| Offline, force-stop/relaunch              | 5 / 5                                       | 6 / 6                 | `5f440e32-ab90-45e2-9db7-a99e0736d02d` |

The system photo picker reported access only to selected photos. Cancelling it left Account B empty. Importing the synthetic coastline JPEG produced capture `d4cc0480-6fc6-4b60-8721-39e28a3eb22a`. After an injected lost upload response, a cold relaunch restored the same pending capture and decoded original. One Retry changed Account B from 1 image / 0 records to 1 image / 1 verified record.

Camera permission denial displayed a useful error and preserved that saved capture. Granting camera access, taking an emulated-camera photo, and accepting it produced a readable local JPEG for capture `f32e9b97-1078-453b-9ce1-17374fc7eed6`. Saving from Details at `font_scale=2.0` and density 540 (320-point width) verified its image and record. The outbox, all three source choices, Done, the full capture ID, and receipts remained readable; Details scrolled to Save. A subsequent cold restart restored confirmation. Account B finished with 2 images / 2 records. Switching back restored Account A's 6 images / 6 records, without exposing B's captures.

Native Back dismissed both the source sheet and Details. The QA emulator's Expo Go Tools button was disabled so its floating development badge did not obscure Add photo. Font scale was restored to 1.0 and density to 420 afterward.

One immediate force-stop/relaunch attempt left Android's launcher in the foreground while Expo Go remained alive; the harness timed out. Crash and JavaScript error buffers were empty. Redelivering the launch restored the pending offline capture. Two later cold launches passed when the harness waited for the launcher before issuing `am start -W`. No product code was changed to address this launch-sequencing observation.

The collected crash buffer and `ReactNativeJS:E` / `AndroidRuntime:E` logs were empty. SHA-256 comparison confirmed that all 19 protected recovery/config/schema/test files and all 5 app/UI/package/index files were unchanged during this Android pass. The additional repository edits are QA documentation and screenshots. Raw UI trees, screenshots, expected-count assertions, source hashes, and logs are retained locally under ignored `output/android-qa/`. The test emulator and its Metro server were stopped after capture.

[Android pending after cold restart](android-pending.jpg) · [Android saved](android-confirmed.jpg) · [Android verified receipt and totals](android-receipt.jpg) · [Android large-text receipt](android-large-text.jpg) · [Android large-text source picker](android-large-text-picker.jpg)

## Real Supabase connectivity

On 2026-10-12 the existing HTTP suite passed 9/9 against the starter's isolated local Supabase stack. The migration was already applied, and no schema or recovery code was changed. Auth, Storage, PostgREST, RLS, signed downloads, deletion fences, and downloaded fixture-byte equality were exercised.

Android Expo Go also connected with the local client key and decoded signed JPEG downloads. A test-only loopback HTTP proxy forwarded requests to the real services and could close the client socket after a successful server response or keep subsequent requests unavailable. The proxy was outside the application and logged only methods, paths, statuses, and fault actions, without bearer tokens or signed-URL query strings.

- A single discarded upload acknowledgement reconciled immediately and finished the save. A discarded database acknowledgement also reconciled immediately. Neither needed another upload or record.
- With connectivity held down after upload, the server contained the image but no ready record. Reconnecting and retrying completed the same capture.
- With connectivity held down after database insertion, the server already contained both writes. Retry verified them without repeating the insert.
- A rejected database HTTP request left its uploaded image available for retry.
- An outage before either write retained the local capture. After restart it remained visible with Retry, and unavailable cloud totals were labelled. Reconnection required no additional app restart before Retry.

This pass found and fixed a UI loading defect: `App.tsx` formerly waited for local journal reads and cloud totals in the same combined result. A failed totals request prevented local photos from appearing after an offline restart. Local photos now render independently; stale refresh results are ignored, unavailable totals are shown without invented zero counts, and the backend label says Supabase rather than asserting a live connection. Recovery, deadlines, journal, remote/file adapters, runtime, schema, native configuration, and core/SQL tests remain unchanged. Expo and Expo Crypto received SDK-compatible patch updates to 57.0.28 and 57.0.4.

After the fix, the sustained upload-outage case was repeated. Capture `85fa23cd-f833-4cd5-8b75-19c381a8f7f3` remained visible after force-stop/relaunch while the backend was unreachable. The server had 8 images and 7 ready records before Retry, then 8 images and 8 records. Each of the eight Android captures had exactly one Storage object and one ready record, checked directly in PostgreSQL. A transient Android UI-automation null-root error interrupted one harness read; the resumed check passed with empty crash and JavaScript error logs.

The final iOS Simulator smoke check also used the real local services. Capture `855c21b5-4332-49f7-80f6-36a2a92a436d` survived termination/relaunch while the backend was unreachable. Reconnection and Retry verified its readable image and record; PostgreSQL confirmed exactly one object and one ready record. This used the final Expo 57.0.28 / Expo Crypto 57.0.4 dependencies in Expo Go 57.0.9.

These are real **local** Supabase services and controlled HTTP interruptions. Hosted TLS, cellular connectivity, physical-device OS behavior, production authentication, and offline standalone-binary launch are separate checks.

[Offline outbox with local captures](supabase-offline-outbox.jpg) · [Unavailable totals and local receipt](supabase-offline-receipt.jpg) · [Recovered save](supabase-recovered.jpg) · [Verified receipt and totals](supabase-verified-receipt.jpg)

[iOS interrupted receipt](ios-supabase-offline.jpg) · [iOS verified save](ios-supabase-verified.jpg)

## Visual review

The outbox uses neutral surfaces, compact thumbnails, real metadata, thin separators, a contextual dark Save/Retry button, and blue secondary links. Four rendered states were compared with the selected mockups: empty, save unconfirmed, retrying, and saved. Full-view and focused comparisons are recorded in [`design-qa.md`](../design-qa.md).

Photo labels are capture ordinals, not invented filenames. Saved means this capture's image and record have been verified. Account totals never make another capture's receipt appear verified. A missing local original displays Unavailable; local retention is shown only after decoding the actual local image. Retrying is transient UI activity, not a new journal state or a simulated progress percentage.

Details contains the full preview, capture ID, receipt, trace, totals, verification, and soft removal. Test controls stay separate from the photo list. Controls have at least 44-point targets; the smaller Retry surface sits inside that target. Web keyboard focus is visible, selected radios expose checked state, decorative icons are hidden from assistive technology, and a sheet hides the outbox behind it. Blue links have 4.95:1 contrast on white; muted text has 4.84:1 and warning text 5.06:1. Disabled controls use their distinct inactive treatment. These focused checks do not establish full accessibility compliance.

A historical error cannot claim that an unavailable or unread local original is kept. The browser checks both a missing original before upload and an evicted original after upload; the latter finishes from the existing cloud image without creating another object.

The retrying screenshot holds a real ImageLoader verification request in the browser test harness, then releases it. No delay, fake busy state, or additional failure mode was added to the app or recovery core.

[iOS interrupted save](ios-pending.jpg) · [iOS saved outbox](ios-confirmed.jpg) · [iOS largest-text receipt](ios-large-text.jpg) · [iOS largest-text picker](ios-large-text-picker.jpg)

The recovery controller, journal, deadlines, remote/file adapters, runtime, schema, and core/SQL tests are byte-for-byte unchanged from the prior starter. `App.tsx` adds transient UI activity, routes row actions by capture ID, and prioritizes unfinished captures when restoring the outbox. Those callbacks call the same save/remove methods and retain the existing account/operation guards. Ionicons and the SDK-compatible Expo Font package supply real icons; no native app configuration or backend configuration was changed.

The selected outbox mockups and public photo/file-app references supplied visual direction.

## Sample-image provenance

`assets/sample-coast.jpg` was generated for this project with the built-in ImageGen tool on 2026-10-11, then converted to JPEG without visual edits. It depicts an original tropical cove, turquoise water and limestone shoreline, natural afternoon light, with no people, boats, identifying landmarks, text, UI, or logos. The source picker and README identify it as AI generated. The older illustrated sample remains the unchanged synthetic local Supabase HTTP fixture.

## Remaining device checks before adopting

- Run the app on physical iOS/Android phones and in your own standalone native build. The emulator pass used Expo Go.
- Exercise camera and limited/denied photo-library permissions.
- Repeat connectivity interruptions on a separate hosted test backend and real phones; the local proxy pass does not establish cellular or hosted TLS behavior.
- Check your login/logout/token-expiry paths, account changes during held saves, low storage, backup policy, and image limits.
- Validate physical erasure/retention separately from this starter's soft removal.

No hosted deployment, physical-device run, background OS transfer, or upstream bug fix is claimed. GitHub publication was authorized after local testing; the X post remains a draft.

## Dependency audit

The SDK-compatible lockfile has existing upstream advisories in the Expo/Metro toolchain (`braces`, `node-forge`, and the older `uuid` dependency in `xcode`, with transitive findings). No blanket audit-clean claim is made. Recheck compatible upstream updates before adoption; a forced downgrade to Expo SDK 44 is not an appropriate repair for this SDK 57 example.
