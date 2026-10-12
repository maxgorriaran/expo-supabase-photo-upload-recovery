# Verification

Local verification on 2026-10-11. These layers establish different things; none establishes a hosted release or physical-device acceptance.

| Layer                                    | Observed result | What it checks                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                               | Passed          | App, platform adapters, recovery core, and test types                                                                                                                                                                                                                                                                                                                            |
| Core                                     | 39/39 passed    | Partial saves, lost acknowledgements, restart, concurrent taps, corrupted records, missing/invalid files, account changes at every remote stage, A/B/A generation changes, removal during upload, permanent deletion, disk failure, late commits after deadlines                                                                                                                 |
| PostgreSQL                               | 10/10 passed    | Actual migration in PGlite, ownership RLS, immutable IDs, missing/empty/oversized objects, private paths, create-only storage, permanent tombstones, anonymous database role denial                                                                                                                                                                                              |
| Local Supabase HTTP                      | 9/9 passed      | Actual Auth, Storage, PostgREST, migration, signed downloads, repeat retries, two account identities, cross-account denial, and removal guards; downloaded bytes match the synthetic JPEG                                                                                                                                                                                        |
| Browser                                  | 12/12 passed    | Six failure/save flows at 1280px, recovery at 390px and 320px, reload/IndexedDB persistence, account isolation, removal, verification failure, older captures, the visible recovery demo, and missing local bytes. Receipt checks reject false verification from account totals or a lost acknowledgement. No uncaught errors or horizontal overflow.                            |
| iOS and Android Hermes exports           | Passed          | Latest native module resolution and bytecode bundles. Android runtime and physical-device behavior remain untested.                                                                                                                                                                                                                                                              |
| iOS Simulator, Expo Go 57.0.9 / iOS 26.5 | Passed          | Native JPEG normalization, document-directory persistence, image decoding, injected lost upload response, force-stop/relaunch, and one-action retry. Capture 6dd5005e stayed the same; account B totals moved from 1 image / 0 saved records to 1 image / 1 saved record. The final typography adjustment was separately rendered at normal and maximum accessibility text size. |

The fault wrapper deliberately injects failure around actual adapter calls. Lost-response cases commit the upload or row first, discard the acknowledgement, then block controller requests until Retry resumes the injected requests. This is controlled failure injection, not a real cellular network outage.

The video is captured from real browser interactions with the labelled simulated backend. Its persistence uses actual IndexedDB and AsyncStorage. The local Supabase suite separately exercises the real HTTP adapter. The video is not evidence of a hosted backend or a phone running Supabase.

## Rendered design review

The interface now tells the recovery story through a state headline, compact photo, three-step receipt, and one primary action. **Try interrupted save** makes the main demo discoverable without opening advanced controls. Pending saves lead to **Retry save**; confirmed saves lead to **Add another photo**, with **Verify again** in Details. Account/capture changes return the screen to the top.

The receipt uses this capture's verification stages, not account-wide counts. A lost upload response remains **Unconfirmed** until recovery checks it. A missing local file displays **Unavailable** rather than **Kept**. The local step becomes green only after the actual local preview can be decoded. Failure selectors, photo selection, diagnostics, and soft removal remain available through disclosures. Native choices use selected buttons; browser choices also expose checked radio semantics.

Reviewed empty, local, interrupted, recovered, verification-error, removal, and missing-file states in the rendered browser at desktop, 390px, and 320px. The native simulator separately covered capture, interrupted save, relaunch, recovery, and large text. The final native typography caps display-heading growth, keeps body/action text scalable, and stacks the receipt vertically at larger font scales. Maximum iOS accessibility text size remains scrollable; this does not establish VoiceOver or physical-device acceptance. Keyboard focus has a visible border, and controls have a minimum 48-point target. Safe areas use the SDK-compatible context provider. This is agent review for human inspection, not owner design acceptance.

The requested design-brief workflow was applied. Its verified catalog retrieval was blocked by an existing knowledge-base edit, which was left untouched. No catalog inspiration assets or experimental synchronization tools were used.

[iOS pending state](ios-pending.jpg) · [iOS recovered state](ios-confirmed.jpg)

[iOS largest-text receipt](ios-large-text.jpg)

The recovery controller, journal, deadlines, remote adapters, runtime, schema, and existing core/SQL tests are unchanged by this UI redesign. `App.tsx` changes only the bundled sample-image reference. No new packages were added.

The local Supabase HTTP result comes from the original starter verification; that suite was not rerun for this UI-only change. Its adapter, migration, and synthetic JPEG fixture are unchanged. The static/core/SQL checks, browser suite, native exports, rendered review, and demo recording were rerun for the redesign.

## Sample-image provenance

`assets/sample-coast.jpg` was generated with the built-in ImageGen tool for this project on 2026-10-11, then converted to JPEG without visual edits. Prompt: an original photorealistic tropical cove, turquoise water and limestone shoreline, natural late-afternoon light, central landscape crop, no people, boats, identifying landmarks, text, UI, or logos. The initial preview labels it AI generated; the README identifies it as synthetic. The older illustrated sample remains a synthetic fixture for the unchanged local Supabase HTTP test.

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
