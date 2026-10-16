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
