# Verification log

This is the detailed record of what was checked during development, moved here unchanged from the README on
2026-10-16 so the README can describe the finished application. Entries are in the order the passes happened.

- **Observations, not guarantees.** Each entry says what was observed in a specific check, on a specific setup, at
  that time.
- **Superseded entries are kept.** Some mention behaviour that was later changed or removed (for example the Revise
  action and the first marker layouts), and the passes that changed them say so.
- **Related records:**
  - [progress.md](progress.md) has the shorter build notes;
  - [ai-sessions/](ai-sessions/README.md) has the full development conversations.

Automated:
- **Vitest (45):** (8 added in the correction pass: newline, history steps, refresh guard, geometry; 7 in the interaction pass: clusters, family and selection-action placement, connections, leaving a document; 9 in the change-marking pass: boundaries, saved-version compatibility, Markdown around markers, deletion markers; 1 in the scrolling pass: the sticky clamp rule)
  - Bridge fixtures on real Tiptap parse/serialize: repeated words, link text equal to its URL, nested and ordered
    lists, Markdown-looking code, cross-block selections, loud failure.
  - Repeated-wording targeting, far edits vs. nearby-context staleness, refusal of stale Accept, late results after
    discard, full-deletion pop with undo, boundary-straddling block.
  - Undo/Redo version linkage: pop on v1 → refine to v2 → Undo restores v1 with its pop and thoughts → Redo restores
    v2 from cache with no request and unchanged spend; Accept → Undo while another review survives.
  - Diff grouping and losslessness.
  - Enter on a second reflection issues one refine with `isNew` and the effective proposal.
  - An unchanged result is not installed: the previous version and reflections are kept, and both attempts are in
    the ledger.
  - Formatting-only changes and intentional deletions count as real changes.
  - A refinement after a pop carries the keep-original choice and flags kept wording that went missing.
  - Marker clusters: deterministic, staggered (neither a column nor a row), no overlap with the motion envelope or at
    touch size, minimal push-down, narrow single column; family placement; connection choice (passage, miniature
    straight or bent, none); selection-action placement.
  - Leaving a document: in-flight request cancelled, late result ignored, spend kept, reload shows the start page.
- **xUnit (14):**
  - request bounds, outcome parsing with actual cost, unknown cost, empty replacement, truncated / malformed / unsafe
    output, 402/429 mapping, prompt fencing and keep-original records;
  - the no-change rule: whitespace vs. paragraph and formatting changes;
  - exactly one correction, with both calls reported;
  - still unchanged after the correction → no third call;
  - the removed `revise` action is rejected by validation;
  - a failed correction still reports the first call.

Walked through in the in-app browser:
- Import; select → + Bubble → reflection → candidate; pop from source and from candidate; Accept → Undo/Redo;
  outside-click and Escape minimize.
- Markdown view decorations, Accept there and Undo after switching back.
- Reload recovery, and reload during generation (Interrupted, no replay).
- Busy, edit-during-generation (installed as outdated), provider failure with Retry, cancel during generation,
  Retarget, and keyboard pop.
- Layouts: 1440×900, 1024×768, 1280×560 (offscreen source and a long three-reflection family) and 390×844.
- Revision of 2026-10-16:
  - a working slice measured in the real editor: plus icons centred (0 px offset), unchanged line height beside
    insertion markers, content-sized reflections, computed dots;
  - hover highlighting with no connector line;
  - real clicks popping added (source +), altered (suggestion) and deleted (source) changes, with hover cleared;
  - Enter-to-refine;
  - fixture `#same` (corrected, 2 calls) and `#stubborn` (failure with Retry, proposal kept);
  - Revise, including "nothing to revise" (the feature was removed in the 2026-10-16 interaction pass);
  - a clustered markers / long family / generating state at 1440 and the docked dark layout at 390;
  - regression checks after the revision: Accept/Undo/Redo, Markdown switch, outside-click minimize and reload
    recovery.
- The published app started from `./publish` and served UI, API and SPA fallback.

Live OpenRouter calls: five completed for $0.0135 actual (returned `usage.cost`), plus one interrupted by a reload
with unknown cost, well within the $5 key cap.
- **Smart:** initial ($0.0044, 5.1 s) and refine respecting a popped keep-original choice and a two-sentence request
  ($0.0085, 314 reasoning tokens).
- **Fast:** outdated refresh ($0.00036, 3.8 s), a grammar/tone fix on the published build that kept the facts
  ($0.00015), and the same mid-word selection after the prompt fix, which now continues the fragment correctly
  ($0.00015).
- **After the 2026-10-16 revision (all within the $5 cap):**
  - Smart initial suggestion ($0.0042), then "too verbose" submitted with Enter: a genuinely shorter refinement on the
    first call (53 → 44 words, $0.0048, no correction needed);
  - Fast Revise after keeping one original phrase: coherent repair, nothing flagged ($0.00044). It also reworded one
    later phrase beyond the minimal repair, which shows in the diff (Revise was later removed).

**Correction pass of 2026-10-16** (placement, chain, Accept newline, Undo steps).

Causes found:
- Accepting "Eduardo shipped" added a line break because the stored model replacement was `"Eduardo shipped\n"`.
  Accept applied it exactly; it is now removed for inline selections.
- Undo landed on "Thoughts changed" because an Enter submission and its suggestion were two separate history entries.
- Reflections were laid out independently, and their dots and the passage dots ran over other bubbles and minimized
  reviews.

Verified:
- **Reproduced each failure first in the dev editor:** two lines after Accept; two entries per Enter refine with Undo
  landing on "Thoughts changed"; passage dots crossing a minimized review.
- **Real editor, after the fixes:**
  - Accept in mid-paragraph stays in one paragraph, and immediate Undo/Redo restores and re-applies with no request.
  - Enter refine is one Undo step; a failed Enter submission shows "Update failed — previous suggestion shown" with
    Retry and "Not yet applied".
  - A multiline reflection grows while typing, with Shift+Enter kept as a newline.
  - Opening a review beside three minimized reviews.
  - Bounds measured at 1440, 1024 (also scrolled) and 390: 0 bubble overlaps and 0 dot contacts, including the motion
    envelope.
  - The recording decodes in the app; audible playback could not be checked from here.
- **Live Fast calls ($0.00038):** "it was only eduardo" → "Eduardo shipped", accepted inline; a refine submitted with
  Enter.
- **Tests:** Vitest 28/28, xUnit 14/14.

**Interaction pass of 2026-10-16** (clusters, connections, peek, highlights, +, selection action, Try again, Revise
removed, title navigation).

Causes found:
- Opening a review reshuffled the markers for two reasons. The open review was left out of marker placement, so the
  others re-slotted. And the open review's insertion + re-wrapped a line, which moved later anchors.
- The old placement used two fixed columns, which made the grid look.
- Hover drew rectangles over the already-rounded decorations: an offset duplicate outline.
- The inline + sat low because its inline-grid took its baseline from the SVG; in Markdown headings it was outside
  the enlarged token.
- Touch-size (44 px) markers were spaced as 34 × 24.

Verified in the real editor (fixture provider):
- **Five reviews on nearby lines:**
  - a staggered 2-2-1 cluster;
  - each review opened in turn with every marker position identical, and identical again after minimizing;
  - the active rim and `aria-pressed`;
  - every review connected (four from their miniature, one from the passage);
  - hover and focus on each marker highlighted only its passage, with no request, and overlapping reviews stayed
    distinct.
- **Layout:** 0 marker overlaps, 0 markers on bubbles and 0 dot contacts at 1440, at 1024 (also scrolled) and at 390
  (single column, touch size, docked family, no horizontal scroll).
- **Highlights:** a wrapped deletion ringed per line fragment, on exactly that review's source span and candidate
  marker, with no layout shift.
- **Insertion +:** circle centre against the text centre: paragraph +0.19 px, bold +0.19, heading +0.77, Markdown
  +0.69, Markdown heading +0.09 (cap-height centre within 1 px too). Line heights are unchanged.
- **Selection action:**
  - centred 6 px above a word;
  - above the first line of a two-line drag selection;
  - clamped at the left edge, and below the line at the top edge;
  - back above after scrolling, and re-measured after a resize;
  - still under pointer approach;
  - click, Tab + Enter (Formatted) and Ctrl/Cmd+Alt+M (Markdown) each created the review from exactly the selection.
- **Title:**
  - Cancel kept everything;
  - Leave with a 4 s request in flight showed the start page, and the request stayed in spend as "cancelled · charge
    unknown" with no late install;
  - a reload stayed on the start page, with all 48 ledger entries kept.
- **Regressions:** Enter submission (one Undo step), Try again (refine), pop by clicking the source (no request),
  Accept → Undo → Redo with no request, Markdown marks with review ids, and the recording decodes.
- **Published build:** UI, `/api/config` and SPA fallback.
- **One live Fast call ($0.0002):** "honestly the results was kind of good and people liked it alot" → "...were kind of
  good and people liked it a lot", keeping the casual tone.
- **Tests:** Vitest 35/35, xUnit 14/14.

**Change-marking pass of 2026-10-16** (boundaries, Markdown around markers, red −, borders, close icons, tip strip).

The reported screenshots were investigated by running their *transcribed* text through the app's diff and renderer.
The original saved candidates were not available.

Causes found:
- **Grouping.** Change runs separated by one kept space were merged with that space on both sides. So
  `term when` → `term, the kind of day when` became an alteration of a single space (a tiny yellow mark), and groups
  carried shared edge spaces.
- **Rendering.** The invisible marker characters count as letters for Markdown emphasis rules, so
  `that ` + marker + `**[Albus Dumbledore](…)**` no longer opened bold and showed literal `**`.
- **Not a defect.** The second screenshot kept the word "when", so word-level fidelity correctly shows it between
  two separate changes.

Changes:
- **Boundaries.** Whitespace both sides share at a group's edge moves to the surrounding text, and each group is
  classified from what remains.
  - Ids, order, text and pops are unchanged.
  - Saved versions are normalized the same way when loaded.
- **Markers.**
  - A marker cluster touching a `*`/`_`/`~` run moves across it only when that restores the run's flanking. A marker
    at a line start moves past the block marker.
  - Every render is verified against the marker-free parse. A change that still cannot be marked inline is listed by
    its own text under the suggestion, still hoverable, source-linked and poppable.
- **Red −** at deletion points; ␣/↵ symbols for whitespace-only changes.
- **Rounded-rectangle source outlines** and geometric close icons.
- **The Formatted-view tip strip is removed.**

Verified:
- **A review saved before the fix (the transcribed screenshot-2 text, with one pop), reloaded after it:**
  - the one-space alteration became an Added group;
  - the pop was kept and the text was identical;
  - no request was made;
  - the bold link rendered.
- **Real editor:**
  - the comma insertion shows a green + and ", the kind of day";
  - three red − markers, each within 0.69 px of the text centre;
  - hover and focus on a − rang exactly the matching source deletion; click and Enter popped it with no document
    change and no request;
  - a whole-selection deletion shows one − and its note;
  - the ␣ and ↵ symbols left paragraph heights unchanged and kept the line break;
  - the long alteration wraps with its highlight;
  - every close/minimize icon sits exactly centred (0 px) in its 26 px (22 px) hit area;
  - there is no tip strip;
  - checked in light and dark.
- **Regressions:**
  - Enter refine (one call, one step);
  - Try again / Retry;
  - `#same` correction (2 entries);
  - stable clusters and peek;
  - Accept/Undo/Redo;
  - reload recovery;
  - sound decode after a gesture;
  - title dialog;
  - spend.
- **Tests:** Vitest 44/44 (added: boundary normalization, exact Accept with a pop, saved-version compatibility, and the
  renderer cases for bold, emphasis and strikethrough links, partially changed bold, the listed fallback, and
  deletion markers), xUnit 14/14.

**Selection and scrolling pass of 2026-10-16** (scroll jump on creation, missing "+ Bubble", clamped-scroll lag).

Causes fixed:
- **Scroll jump.** The first reflection was focused (plain `focus()`) before the new family had a position, so the
  browser scrolled toward the top of the rail. It now focuses with `preventScroll`. The family is placed before the
  first paint and stays transparent until then.
- **Missing "+ Bubble".** The just-used range stayed suppressed forever. Suppression now lasts only while that
  selection is unchanged: it is cleared by a new pointer gesture, a different selection, a new document, an edit or a
  view switch.
- **Clamped-scroll lag.** A family clamped to the viewport was repositioned only after a React round trip (one frame
  late, 4 px per frame in the investigation).
  - The family is now `position: sticky` in a full-height track. A spacer holds its natural top; a margin would stop
    sticky from moving it up.
  - The browser applies the clamp on every scrolled frame.
  - One placement function, run after each render and from the scroll event, keeps cached geometry and redraws the
    connection with the same clamp rule (`clampFamilyTop`).
  - Scrolling no longer re-measures every review.

Verified in the real editor (disposable 36-paragraph document, fixture provider, saving switched off at runtime):
- **Sticky gate, before the rest of the refactor.**
  - The first arrangement, with a margin-based natural top, never bottom-clamped. It was corrected to a spacer.
  - Then `clampFamilyTop` matched the rendered position within 0.13 px over 263 scroll offsets each for a
    mid-document review, a review at the document end and a tall family. Within 0.5 px after resizes and with a grown
    reflection (whole-pixel snapping).
  - Both clamps occurred.
  - Inputs, controls, markers, document selection and outside-click minimize worked through the
    `pointer-events: none` track.
- **Per-frame scrolling** (4 px and 20 px per frame, plus a tall family and Markdown view), each frame read, then
  forced through a full React placement and read again:
  - 0 delayed family corrections in 650 frames;
  - dots identical within 0.1 px;
  - markers never moved;
  - unclamped, the family kept its offset to the passage.
- **Creation at the document end, Formatted and Markdown:**
  - `scrollTop` is unchanged at the focus call, at `focusin` and after settling (3398 and 3401);
  - the family sits 30 px above its passage, in view, without "Back to passage";
  - the reflection is focused.
- **Dismissal:**
  - right after creation the unchanged selection stays suppressed;
  - create → Undo and create → pop, then reselect the same range: the action shows, by pointer and by Shift+arrows,
    in both views;
  - a new document with the same offsets, a source edit and a view switch carry no suppression;
  - a control (the same range, nothing in between) stays suppressed.
- **Short regression:** Enter refinement (one call, one step), Back to passage, Undo, title dialog, recovery on
  reload, sound, spend.
- **Tests:** Vitest 45/45 (added: the sticky clamp rule), xUnit 14/14.
