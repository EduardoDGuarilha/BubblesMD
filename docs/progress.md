# Build progress

## 2026-10-15/16: implementation session (Claude Code, single agent)

**What works:**
- The full writing flow in both views: select, reflect, suggest/refine, inspect/pop, accept/reject, Undo/Redo.
- Several reviews, minimization, outdated refresh-once, Busy/Retry/Interrupted, Retarget.
- IndexedDB recovery, landing/import/export/replace, Fast/Smart with actual cost.
- A published single ASP.NET app.

**Main choice:**
- The canonical Markdown string is owned by the app store, with editor adapters and a PM↔Markdown alignment bridge.
- Snapshot history tracks the document plus review state, including the active candidate version; candidate
  payloads and the ledger live outside history.

**Checks actually run:**
- Vitest 16/16, xUnit 9/9, client typecheck/build, `scripts/build.ps1` publish, and the published app started and
  served UI/API.
- In-app browser walkthroughs at 1440, 1024, 1280×560 and 390 widths. See the README "Verification performed".

**Failures found and fixed during the build:**
- `useImperativeHandle` without deps caused a render loop.
- Undo built nodes with a different ProseMirror schema instance, which blanked the Formatted view.
- Adding hover classes to editor-owned decoration DOM made ProseMirror re-render under the pointer, so clicks were
  lost; replaced with an SVG overlay.
- Trailing newline normalization.
- The docked review collapsed on narrow screens.
- The published app used the working directory as content root.
- The "+ Bubble" button overlapped markers.
- Tall review families hid reflections below the fold.
- `createReview` accepted out-of-range offsets.
- A NuGet restore failed on a private machine feed; a project-local `nuget.config` now uses nuget.org.
- Haiku repeated a word fragment for a mid-word selection; the prompt now states such boundaries.

**AI usage:** $0.0135 actual across 5 completed live calls (Smart ×2, Fast ×3, one of them on the published build),
plus one call interrupted by reload with unknown cost. All other mechanical checks used the zero-cost fixture
provider.

**Remaining issues:** see README "Known limitations".

## 2026-10-16: visual and interaction revision

**What changed:**
- Soap-bubble families: content-sized translucent bubbles, computed thought dots, clustered markers, centred plus
  icons, hover highlight without a connector line.
- Clicking any change pops it (including the source +).
- Enter on a reflection requests an update directly; explicit Revise after pops.
- One server-side corrective call when a model makes no change, with both calls counted.
- Synthesized soap-bubble pop with a rupture animation.

**Root cause of "too verbose" returning the same text:**
- Later reflections only committed locally.
- The prompt did not mark new reflections.
- The prompt sent the raw previous replacement instead of the effective proposal.
- An identical output was installed anyway.

**Checks actually run:** Vitest 20/20 and xUnit 14/14, plus the browser walkthrough listed in the README. One bug was
found and fixed in the browser: pausing the float under the pointer also froze newly inflating bubbles at opacity 0.

**AI usage this revision:** $0.0094 across 3 live calls (Smart ×2, Fast Revise ×1). Fixture checks were free.

## 2026-10-16: correction pass (placement, chain, Accept newline, history, Enter flow, sound)

**Causes:**
- The model returned `"Eduardo shipped\n"` for an inline selection, so Accept inserted a soft line break.
- An Enter submission recorded two Undo steps.
- Flex-wrapped reflections were each linked to the main bubble.
- The passage dots ignored minimized reviews.
- The refresh-once guard was not persisted.

**Fixes:**
- Narrow removal of a single accidental boundary break.
- A submission-scoped history merge (never across other actions or Undo), and creation joined with the first reflection.
- A geometry module for the wrapping chain, obstacle-routed dots and envelope-aware marker slots.
- The supplied pop recording.

**Checks:** Vitest 28/28 and xUnit 14/14, plus the browser verification listed in the README. In the hidden browser
pane, CSS animations and ResizeObserver callbacks were throttled, so geometry was also audited from resting bounds
plus the motion envelope; a window-resize re-layout was added for robustness.

**AI usage:** $0.00038 across 2 live Fast calls.

## 2026-10-16: interaction pass (clusters, connections, peek, highlights, +, selection action, Revise removed, title)

**Causes:**
- Opening a review reshuffled the markers because the open review was left out of marker placement, so the others
  re-slotted. Also, the open review's insertion + takes inline width and re-wrapped a line, which moved later
  anchors and regrouped clusters (found while checking the fix).
- Fixed two-column slots made the grid look.
- Hover drew SVG rectangles over the already rounded decorations, so the outline appeared offset and duplicated
  (worst on wrapped text).
- The inline + sat low because an inline-grid takes its baseline from the SVG's bottom. In Markdown view the widget
  also sits outside the enlarged `#` heading token.
- "+ Bubble" lived in the rail.
- With a coarse pointer the markers are 44 × 44 while placement assumed 34 × 24 (found at 390 px).

**Changes:**
- Clusters: honeycomb packing per local cluster, every review kept, and minimized measurements kept while one is open.
- Family placement separate and beside the clusters.
- Connections: passage first, then the active miniature (straight or one bend), else no dots.
- Scoped style rules for the change ring and the passage peek.
- The + is a baseline-aligned, one-line-tall box; in Markdown it takes the size of its token.
- Contextual selection action.
- Try again.
- Revise removed (client, server, prompt, fixture, tests, docs).
- Title → start page through the New confirmation, with `closeDocument` persisting the start page.

**Checks:** Vitest 35/35 and xUnit 14/14. In the real editor, the five-nearby-reviews case:
- identical marker positions minimized, while each is open and after minimizing;
- every review connected (four from their miniature, one from the passage);
- 0 overlaps and 0 dot contacts at 1440, at 1024 (also scrolled) and at 390;
- peek per marker by hover and focus, overlapping reviews distinct, no request;
- a wrapped deletion ringed per line with no layout shift;
- + centre within 1 px of the text centre (paragraph, bold, heading, Markdown);
- the selection action by mouse, drag, keyboard and Tab+Enter, at the edges, and after scroll and resize;
- title Cancel / Leave with a request in flight (cancelled, kept in spend), with reload staying on the start page;
- regressions: Enter submission, pop, Accept/Undo/Redo, Markdown, sound decode.

## 2026-10-16: change-marking pass (boundaries, markers, red −, borders, close icons, tip strip)

**Source of the findings:** a forked investigation reproduced the two screenshots from their transcribed text with
the app's own diff and renderer. The original saved candidates were not available, so the conclusions rest on the
transcription (the boundary words match the screenshots).

**Causes:**
- Merging change runs across one kept space put that space on both sides, which made a punctuation-led insertion an
  "alteration" of one space.
- Private-use marker characters next to `**` changed its flanking, so a bold link rendered as literal `**`.

**Changes:**
- Shared edge whitespace is normalized out of groups. Saved versions are normalized on load with the same ids, texts
  and pops.
- Flanking-preserving marker placement, with every render verified against the marker-free parse. Any change that
  still cannot be marked is listed by its text and stays poppable.
- Red − deletion markers and ␣/↵ whitespace symbols (presentation only).
- 4 px rounded source outlines and SVG close/minimize icons.
- The Formatted-view tip strip is removed.

**Checks:**
- Vitest 44/44 and xUnit 14/14.
- A review saved before the fix reloaded with corrected kinds, its pop kept, identical text and no request.
- Real-editor measurements and a regression pass, as listed in the README. Exact candidate texts were injected through
  a dev-console stub of the suggest function; no paid calls.

## 2026-10-16: selection and scrolling pass

**Causes** (from a forked investigation, reproduced in the real editor):
- A plain `focus()` on the first reflection before the family was placed made the browser scroll toward the top of
  the rail.
- The dismissed selection key was never cleared.
- A clamped family followed scrolling one React round trip late.

**Changes:**
- `focus({ preventScroll: true })`, and the family stays transparent until placed.
- Temporary dismissal.
- The family is sticky in a full-height track, with a spacer for its natural top.
- One placement owner (full after renders, scroll from the scroll event) with `clampFamilyTop`, validated against the
  rendered sticky position.
- Scrolling no longer re-measures reviews.

**Checks:**
- Validation gate first: the margin-based arrangement failed the bottom clamp and was corrected.
- Then:
  - 0 delayed corrections in 650 measured frames;
  - dots within 0.1 px;
  - creation at the end keeps `scrollTop` in both views;
  - dismissal lifecycle by pointer and keyboard in both views;
  - regressions.
- Vitest 45/45, xUnit 14/14.
