# Bubbles.MD product specification

Feature: 001-bubbles-md. Status: specified, not implemented. Owner: Eduardo.

This is the current product specification. Read [design.md](design.md), [plan.md](plan.md), [tasks.md](tasks.md), and [acceptance.md](acceptance.md) for their respective concerns. Detailed defaults resolve previous ambiguity without claiming new user approvals. The original assessment is preserved privately at [Engineering Assessment 2026.pdf](<../../private/assessment/Engineering Assessment 2026.pdf>).

## Product and scope

Bubbles.MD is a Markdown editor that turns the writer's reflections about a selected passage into a reviewable alternative. Human acceptance commits changes. The original remains intact while a candidate is pending.

Use React + TypeScript + Vite, Tiptap for formatted writing, CodeMirror 6 for editable Markdown, C#/ASP.NET Core 10 Minimal API with HttpClient/System.Text.Json, and browser IndexedDB through idb-keyval. Node/npm are frontend tools only. Publish the built client with the ASP.NET app; no hosted database is required. Setup must also work locally without public deployment.

Editable Markdown, multiple pending reviews, exact selection scope, individual edit pops, coherent acceptance Undo/Redo, local recovery, connected right-side bubbles, satisfying pop feedback, Fast/Smart mode choice, and visible actual spending remain in scope. No accounts, multiplayer, separate preview pane, global chatbot, independent editor engine, ontology/RAG platform, automatic model router, arbitrary model catalog, or analytics dashboard. Do not add a document-wide brief. **Revise** (item 6a) is the explicit coherence repair after popping individual edits; this decision of 2026-10-16 supersedes the earlier exclusion of a Repair button.

## Interaction requirements

1. Select text -> + Bubble -> retain the captured scope and focus one empty reflection. Selection alone, creation, and typing make no model call. No empty large candidate is necessary before the first submission.
2. Enter on the first nonblank reflection submits one initial request. Shift+Enter adds a newline; IME confirmation and repeated Enter must not submit accidentally. During generation, show a connected pending bubble and disabled controls, retaining the source.
3. A completed candidate has Accept, Suggest, Reject, X, and + reflection controls (plus Revise when edits were popped). Enter submits a completed reflection and Shift+Enter inserts a newline. The first submitted reflection generates the initial suggestion; submitting a new or edited later reflection directly requests an updated suggestion from that review's reflections and current proposal, with no extra Suggest click. Blur commits locally and nothing generates per keystroke. Suggest stays available for explicit regeneration. Active notes are user-authored context, not model-generated reasoning.
4. Editing/adding/popping a reflection after generation marks Thoughts changed. It changes future request context without retroactively changing the old candidate. Keep that distinction visible; the user may inspect/accept the existing candidate or deliberately use Suggest to update it.
5. At most one review family is expanded, but several pending reviews can exist. Outside pointer activation or opening another review minimizes the old group. Internal controls, source change markers, and their associated popovers count as inside. Escape minimizes without discarding; normal keyboard focus navigation alone does not collapse the group.
6. Clicking an individual change on either side pops it: altered restores the original wording in the proposal, added (including the source insertion +) removes the addition, deleted restores the deleted wording. Popping never edits the document before Accept, clears obsolete hover state, and never calls AI. Pop a stable change group, not an arbitrary word occurrence.
6a. **Revise** is a separate explicit action available after pops. It repairs the coherence of the current effective proposal using the reflections and the keep-original decisions, without reintroducing rejected edits. Software flags kept wording that went missing and rejected additions that reappear. A Revise that finds nothing to repair installs nothing.
6b. **No-change results.** An initial or refresh result is compared with the selected source, and a refinement with the current effective proposal (runs of spaces are ignored; Markdown/formatting changes and an intentionally empty replacement count as changes). An unchanged result is never installed. The server makes exactly one corrective request with the same model and captured context, explaining that the previous response made no change and asking for a meaningful revision of the requested characteristic rather than a cosmetic one. Both calls count in spending, generating stays active, and cancellation and stale checks apply. If it still makes no change, the previous proposal and reflections are kept and a concise failure with explicit Retry is shown. A text comparison proves only that text changed, never that it improved.
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
