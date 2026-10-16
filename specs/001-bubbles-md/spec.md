# Bubbles.MD product specification

Feature: 001-bubbles-md. Status: specified, not implemented. Owner: Eduardo.

This is the current product specification. Read [design.md](design.md), [plan.md](plan.md), [tasks.md](tasks.md), and [acceptance.md](acceptance.md) for their respective concerns. Detailed defaults resolve previous ambiguity without claiming new user approvals. The original assessment is preserved privately at [Engineering Assessment 2026.pdf](<../../private/assessment/Engineering Assessment 2026.pdf>).

## Product and scope

Bubbles.MD is a Markdown editor that turns the writer's reflections about a selected passage into a reviewable alternative. Human acceptance commits changes. The original remains intact while a candidate is pending.

Use React + TypeScript + Vite, Tiptap for formatted writing, CodeMirror 6 for editable Markdown, C#/ASP.NET Core 10 Minimal API with HttpClient/System.Text.Json, and browser IndexedDB through idb-keyval. Node/npm are frontend tools only. Publish the built client with the ASP.NET app; no hosted database is required. Setup must also work locally without public deployment.

Editable Markdown, multiple pending reviews, exact selection scope, individual edit pops, coherent acceptance Undo/Redo, local recovery, connected right-side bubbles, satisfying pop feedback, Fast/Smart mode choice, and visible actual spending remain in scope. No accounts, multiplayer, separate preview pane, global chatbot, independent editor engine, ontology/RAG platform, automatic model router, arbitrary model catalog, or analytics dashboard. Do not add a document-wide brief or dedicated Repair button in the first delivery; refinement through reflections and Suggest supplies the existing correction path. These were proposals rather than settled requirements.

## Interaction requirements

1. Select text -> + Bubble -> retain the captured scope and focus one empty reflection. Selection alone, creation, and typing make no model call. No empty large candidate is necessary before the first submission.
2. Enter on the first nonblank reflection submits one initial request. Shift+Enter adds a newline; IME confirmation and repeated Enter must not submit accidentally. During generation, show a connected pending bubble and disabled controls, retaining the source.
3. A completed candidate has Accept, Suggest, Reject, X, and + reflection controls. Enter in later reflection entry commits the note locally; only Suggest generates the update. Active notes are user-authored context, not model-generated reasoning.
4. Editing/adding/popping a reflection after generation marks Thoughts changed. It changes future request context without retroactively changing the old candidate. Keep that distinction visible; the user may inspect/accept the existing candidate or deliberately use Suggest to update it.
5. At most one review family is expanded, but several pending reviews can exist. Outside pointer activation or opening another review minimizes the old group. Internal controls, source change markers, and their associated popovers count as inside. Escape minimizes without discarding; normal keyboard focus navigation alone does not collapse the group.
6. Pop a yellow change to restore original wording within the candidate; pop green proposed text to remove it; pop a red source deletion to restore that text in the candidate. The source insertion + locates its proposal rather than rejecting it. Pop a stable change group, not an arbitrary word occurrence. No pop calls AI.
7. Main X and Reject discard the pending review and its thoughts, preserving the committed document. Reflection X removes that thought from future context. Provide Undo for accidental pops. Accept replaces only the valid target, dismisses its family, and is one distinct undoable action. Undo restores source, review, thoughts, and edit choices together; Redo is coherent. Undoing a full target deletion restores its review too.
8. Keep all anchors mapped through real edits. A change inside a target makes its candidate outdated; unrelated edits merely move valid anchors. Changed captured nearby context should also mark a candidate outdated conservatively. Do not invalidate every review for an unrelated edit far away. Complete target deletion pops its branch. Ambiguous mapping is a blocked review state with clear retargeting, never a guessed occurrence.
9. Reopening an outdated review that already had a candidate deliberately triggers one refresh with current source and its retained active thoughts/keep-original intent. Old Accept remains disabled. An unsubmitted draft never generates merely because it was reopened or its source changed. Reopening unchanged reviews is local. Failed/interrupted requests use explicit Retry; no automatic retry loop. Page load and restored minimization never trigger refresh.
10. One AI request may be active across the app. Lock the generating review's thoughts, +, edit pops, Suggest, and model controls; allow writing, minimization, and X. Opening another outdated review while busy shows Busy; do not queue hidden generation. X discards that review, requests cancellation where possible, and ignores its late result. Request completion must recheck source and request identity before installing an actionable candidate.

Keep candidate source and reflection snapshots distinct from current document/notes. Carry explicit keep-original choices on refinement/refresh; never replay old offsets onto changed text. If a choice cannot be mapped reliably, expose that conflict rather than silently dropping it or claiming it was preserved.

Compute a deterministic token-level diff against the captured source. Treat adjacent removed/inserted portions of one contiguous change group as an alteration; unpaired insertions/deletions remain additions/deletions. Moved text may appear as deletion plus insertion; a separate move operation is unnecessary. Preserve stable change identities within the candidate version so popping one cannot redirect another click. If all changes are popped, show Nothing to apply and disable Accept; the review can still be refined or discarded. An unchanged/cannot-apply outcome likewise has no enabled Accept action.

## Visual requirements

Follow [design.md](design.md), including its explicit overrides to the historical sketches. The main candidate contains exactly the selected replacement, with no duplicated original block.

## Company alignment

| Research-informed principle | Evidence in this product |
| --- | --- |
| Context outlasts models | App-owned source/review/thought state; own-review context only; provider-independent records; intent retained across updates. |
| Human judgment and software proof | AI proposes; actual diffs, captured scope, stale checks, explicit acceptance, and Undo determine what changes. |
| Governed spending | Fast/Smart choice, bounded requests, one in flight, visible actual cost, no automatic retry/upgrade loop. |
| Traceable actions | Real request/decision metadata and honest usage/error states; no fabricated approvals or compliance claims. |
| Maintainability and ownership | Familiar C# backend, organized TypeScript, reproducible setup, focused checks, clear limitations and handover. |

These are our application of the reviewed company material, not extra assessment requirements or a claim to reproduce Chiri Brain.

## Acceptance

All [A01–A19](acceptance.md) remain pending. A library choice or static mockup is not a passed behavior. Changing an essential requirement requires an explicit scope decision; routine details follow the documented defaults.
