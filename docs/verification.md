# Verification

Local verification on 2026-10-11. These layers establish different things; none establishes a hosted release or physical-device acceptance.

| Layer                                    | Observed result | What it checks                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                               | Passed          | App, platform adapters, recovery core, and test types                                                                                                                                                                                                                            |
| Core                                     | 39/39 passed    | Partial saves, lost acknowledgements, restart, concurrent taps, corrupted records, missing/invalid files, account changes at every remote stage, A/B/A generation changes, removal during upload, permanent deletion, disk failure, late commits after deadlines                 |
| PostgreSQL                               | 10/10 passed    | Actual migration in PGlite, ownership RLS, immutable IDs, missing/empty/oversized objects, private paths, create-only storage, permanent tombstones, anonymous database role denial                                                                                              |
| Local Supabase HTTP                      | 9/9 passed      | Actual Auth, Storage, PostgREST, migration, signed downloads, repeat retries, two account identities, cross-account denial, and removal guards; downloaded bytes match the synthetic JPEG                                                                                        |
| Browser                                  | 10/10 passed    | Six failure/save flows at 1280px, recovery at 390px and 320px, actual reload/IndexedDB persistence, account isolation, offline removal, verification failure, and access to older captures. No uncaught errors or horizontal overflow.                                           |
| iOS and Android Hermes exports           | Passed          | Latest native module resolution and bytecode bundles. Android runtime and physical-device behavior remain untested.                                                                                                                                                              |
| iOS Simulator, Expo Go 57.0.9 / iOS 26.5 | Passed          | Actual native JPEG normalization, document-directory persistence, image decoding, injected lost upload response, force-stop/relaunch, and one-action retry. Capture a7debc2b stayed the same; account totals moved from 2 images / 1 ready record to 2 images / 2 ready records. |

The fault wrapper deliberately injects failure around actual adapter calls. Lost-response cases commit the upload or row first, discard the acknowledgement, then block controller requests until Retry resumes the injected requests. This is controlled failure injection, not a real cellular network outage.

The video is captured from real browser interactions with the labelled simulated backend. Its persistence uses actual IndexedDB and AsyncStorage. The local Supabase suite separately exercises the real HTTP adapter. The video is not evidence of a hosted backend or a phone running Supabase.

## Rendered design review

The revised interface puts the photo, state, and one next action first. Failure choices, photo selection, and diagnostics use progressive disclosure. Reviewed the actual empty, pending, and confirmed browser states at desktop, 390px, and 320px, and the pending/confirmed native simulator states. The warm neutral and teal palette and original sample were preserved. Native choices use selected buttons; the browser uses radio semantics. Safe areas use the SDK-compatible context provider. This is agent review for human inspection, not owner design acceptance.

The requested design-brief workflow was applied. Its verified catalog retrieval was blocked by an existing knowledge-base edit, which was left untouched. No catalog inspiration assets or experimental synchronization tools were used.

[iOS pending state](ios-pending.jpg) · [iOS recovered state](ios-confirmed.jpg)

## Recheck on devices before adopting

- On iOS and Android phones, test the camera and limited/denied photo-library permission flows.
- Kill/relaunch the app after saving a pending capture; retry the same capture.
- Use a separate test backend and interrupt real connectivity around upload and database writes.
- Test your login/logout/token-expiry paths and verify account switching during a held save.
- Test low-storage errors, image size limits, and your selected filesystem backup/retention policy.
- Implement and validate physical erasure/retention separately from this starter's soft removal.

No production/backend deployment, physical-device run, background OS transfer, or upstream bug fix is claimed.

## Dependency audit

The SDK-compatible lockfile currently reports upstream advisories in the Expo/Metro toolchain (`braces`, `node-forge`, and the old `uuid` dependency in `xcode`, with transitive findings). The installed current registry releases for braces and node-forge remain in the reported affected ranges. `npm audit fix --force` proposes downgrading Expo to SDK 44 and is not an appropriate fix for this SDK 57 starter. No blanket audit-clean claim is made. Recheck `npm audit` and compatible upstream updates before adoption.
