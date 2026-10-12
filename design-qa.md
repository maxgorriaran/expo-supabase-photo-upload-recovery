# Outbox design QA

**Findings**

No actionable P0/P1/P2 visual or interaction findings remain in the tested scope. The selected outbox composition is implemented with real capture data and the existing recovery controller. Android runtime checks now also passed in Expo Go; the scoped receipt and screenshots are in [`docs/verification.md`](docs/verification.md#android-runtime-receipt). This is agent review for human inspection; it does not establish owner acceptance, physical-device acceptance, or a hosted release.

**Visual truth and captures**

The selected source mockups and combined comparisons were reviewed locally. Original reference files and comparison captures are local QA artifacts; the distributable screenshots are under `docs/`.

| State            | Source visual filename                          | Rendered implementation               | Combined comparison                              |
| ---------------- | ----------------------------------------------- | ------------------------------------- | ------------------------------------------------ |
| Save unconfirmed | `exec-af312aa2-45b7-47f7-9918-3370a50a31bd.png` | `output/design-qa/pending-final.png`  | `output/design-qa/pending-comparison-final.png`  |
| Empty            | `exec-7c47128e-ef11-4c3c-81a8-b3c75ba228fc.png` | `output/design-qa/empty-final.png`    | `output/design-qa/empty-comparison-final.png`    |
| Retrying         | `exec-7dece52b-cc42-4f32-a3c6-782c5e6992cb.png` | `output/design-qa/retrying-final.png` | `output/design-qa/retrying-comparison-final.png` |
| Saved            | `exec-10f50e35-2852-457f-875f-2fedf0d98bae.png` | `output/design-qa/saved-final.png`    | `output/design-qa/saved-comparison-final.png`    |

The source is app content without device chrome. Every source is 853 × 1844 pixels. Density-normalized copies are 390 × 844 using Lanczos resampling. Implementations are 390 × 844 at a CSS viewport of 390 × 844 and density 1. Comparisons put the source on the left and the implementation on the right in the same image.

The pending, retrying, and saved comparisons use three actual sample imports: one previously saved, one local, and one interrupted/recovered capture. The source's illustrative timestamps, file sizes, and image crops are not copied. Real values and thumbnails come from the captures. The empty comparison uses a new test context with no captures.

Focused row comparisons are `output/design-qa/{pending,empty,retrying,saved}-rows-final.png`, cropped from the same combined comparisons. The pending crop was inspected for typography, metadata, warning/check marks, button proportions, separators, thumbnails, and footer links. Full views cover page composition, empty whitespace, and the lower test-control disclosure.

The user's in-app browser was also inspected at the same mobile viewport and saved as `output/design-qa/pending-iab-final.jpg`. Its older real capture dates differ from the test fixture. Native screens are saved in `docs/ios-pending.jpg`, `docs/ios-confirmed.jpg`, `docs/ios-large-text.jpg`, and `docs/ios-large-text-picker.jpg`. Native screens include actual iOS chrome and use the simulator's optimized 368 × 800 capture; they are runtime evidence, not pixel-comparison substitutes.

Evidence under `output/` is local and ignored. The demo and native screenshots under `docs/` are the distributable artifacts.

**Required fidelity surfaces**

| Surface                          | Result                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fonts and typography             | System font stack matches the native file-app direction. Outbox is 34-point/700, section labels 16-point/600, photo names 16-point/400, metadata 13-point, status 14-point, and compact links 14-point. The former heavy row names and large secondary links were corrected. Native headings are capped; body/action text remains scalable.                   |
| Spacing and layout rhythm        | 18-point side margins, 64 × 66 thumbnails, restrained radii, thin separators, and a lower test-control disclosure match the source. Extra gaps found in pass 1 were removed. Controls retain 44-point targets; the main button's visible surface is about 35 points tall. Narrow/large-text layouts stack actions and the footer without horizontal overflow. |
| Colors and tokens                | White/neutral-grey surfaces, dark contextual actions, amber uncertainty, and grey confirmed marks. Blue is slightly darker than the generated source for 4.95:1 text contrast on white. Muted text is 4.84:1; warning text is 5.06:1. Retrying has a grey disabled button; no green UI tokens remain.                                                         |
| Image quality and asset fidelity | Real decoded JPEG thumbnails use the existing original coastline asset. Preview uses the original capture, not a raster of the mockup. Missing/removed thumbnails have semantic unavailable/removal icons. Ionicons supply the actual icon assets; no handcrafted SVG, emoji, CSS illustration, or text-glyph substitute was added.                           |
| Copy and content                 | The four states retain their selected wording and hierarchy. Saved applies to this capture, while an older local capture remains Ready to save. Metadata is real. A lost acknowledgement stays unconfirmed until checked; missing local bytes never claim Kept.                                                                                               |

**Comparison history**

1. Pass 1, blocked: rows and the list hint were about 35–60 points too low; row names and blue actions were too heavy. Evidence: `output/design-qa/pending-comparison-pass1.png`. Fix: reduce header/row gaps, remove the extra gap above the receipt footer, and restore regular weights.
2. Pass 2, blocked for remaining refinements: smaller links, empty-state position, disabled-button treatment, and mouse focus borders differed from the source. Evidence: `output/design-qa/*-comparison-pass2.png`. Fix: compact links, aligned empty content, the selected disabled palette, and keyboard-only focus borders.
3. Interaction/native fixes: the web radio lacked checked state, and maximum iOS text crowded Done beside the sheet heading. Fix: explicit web `aria-checked`, capped sheet headings, scalable/wrapping body content, and stacked narrow/large-text footers. The keyboard check now passes; `docs/ios-large-text-picker.jpg` shows Done fully visible and `docs/ios-large-text.jpg` shows the readable, scrollable receipt/action.
4. Missing-original follow-up: an old error could contradict the current Unavailable receipt. Historical error text now requires a decoded local original. `output/design-qa/missing-after-upload.png` and the added browser case cover eviction after upload, then completion from the same cloud image without duplication.
5. Final comparison, passed: opened all four final full-view comparisons plus the focused pending-row comparison after fixes. The compact composition, fonts, colors, thumbnails, state copy, busy treatment, and completion behavior preserve the selected direction. No further visual fixes were made after this comparison.

**Interactions and proof**

- Source picker, scenario selection, older rows, previews, Details, verification, account switching, soft removal, and panel dismissal work.
- Fifteen real browser scenarios passed at 1280px, 390px, and 320px; no uncaught exceptions or horizontal overflow were found.
- A real image-verification request was held in the test harness to inspect Retrying. Mutations disabled, Details stayed readable, and releasing the request completed the same capture. No fake busy state or delay was added to product code.
- Keyboard import, failure selection, save/retry, visible focus, and modal isolation passed. Radio selection is exposed, decorative icons are hidden, and the outbox behind the sheet is hidden from assistive technology.
- Native JPEG capture survived force-stop/relaunch, then the same ID completed with one new image/record. Normal and maximum accessibility text were inspected; the preference was restored to normal.
- Recovery core, adapters, runtime, schema, and core/SQL tests have zero diff from the baseline. The app controller's changes concern UI activity, selection priority, and row-ID callbacks.
- Real local Supabase interruptions exposed a coupled UI load: cloud totals failing prevented local photos from appearing after restart. Local journal results now render independently, refresh results are guarded against replacement, and unknown totals remain unknown. Native outage/retry proof is recorded in `docs/verification.md`.

**Follow-up polish and limits**

Small platform-widget differences remain: web/native spinners and Ionicons have slightly different optical weights from the generated source. The 44-point link targets add a little more whitespace than the mock. These are acceptable P3 differences. Android's outbox, source picker, full capture ID, receipts, Done, and Save were inspected at 200% text size and a compact 320-point width. Full VoiceOver/TalkBack, standalone native builds, physical-device permissions, and real network interruptions remain separate adoption checks.

**Implementation checklist**

- [x] Compare empty, interrupted, retrying, and saved states with the selected visuals.
- [x] Fix spacing, weights, compact links, focus/disabled states, radio semantics, and large-text sheet headings.
- [x] Verify browser failure cases, keyboard paths, native restart recovery, and large text.
- [x] Verify all six Android save scenarios, system-picker cold recovery, emulated-camera import/denial, account isolation, native Back, and large-text Save without changing app or recovery code.
- [x] Preserve recovery code and refresh the demo, README, screenshots, and X draft.
- [x] GitHub publication authorized after completing local testing.
- [ ] X publication remains a separate manual action.

final result: passed
