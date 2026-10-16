# Behavior reference and risk-based verification

Status: implementation unstarted. Product behavior remains in scope. R labels identify documented defaults, not newly claimed user approvals.

## How to verify

Choose checks by failure risk:
- Automate meaningful cases around wrong-target replacement, stale acceptance, and document/review Undo. Repeated wording and edits before/inside a target are useful examples. Add cases for a concrete risk or observed bug, without a test-count or coverage target.
- Walk through the real flow: create/open, select, reflect, suggest/refine, inspect/pop changes, accept/reject, and Undo. Continue through editable Markdown and reload recovery. One integrated walkthrough can demonstrate several behaviors.
- Use local fixtures for representative stale/overlapping-source and delayed/error cases. Paid calls are for actual integration and writing quality.
- Inspect the real layout against design.md, including a difficult long review and narrow view. Visual checks need no per-control automation.
- Run builds and a fresh setup/startup check. Preserve genuine sessions and accurate README instructions.

Use a few representative writing examples across Fast/Smart modes, including facts/intent and refinement. The twelve research cases are an optional case bank, not a mandatory model-by-case matrix.

## Behavior reference

A01–A19 help locate expected results. They do not require nineteen separate automated tests, reports, or exhaustive permutations. Group checks naturally and keep brief observed results in [progress.md](../../docs/progress.md).

| ID | Scenario | Passing result |
| --- | --- | --- |
| A01 | Select a word, formatted sentence, and multiple paragraphs; focus and submit the first reflection. | Each captured scope remains the target. Creating/selecting/typing alone makes no AI request. Enter submits the initial reflection once; there is no initial Suggest button. Submitting a later reflection requests an updated suggestion directly; Suggest remains for explicit regeneration. R: Shift+Enter adds a newline; blank input and composition confirmation do not initiate inference. |
| A02 | Add different reflections to overlapping reviews; generate and refine one. | Only that review's active reflections enter its request. The original stays unchanged; earlier compatible intent is retained on refinement. |
| A03 | Compare known candidates containing insertion, alteration, deletion, and repeated wording. | Software derives the displayed differences. Markings point to the correct occurrences; hover/focus highlights the matching source and suggestion spans (no connector line). |
| A04 | Pop each change category separately and in combination. | Clicking a change on either side (including the source +) reverts the intended edit only. The original document stays untouched and remaining text is readable. No automatic repair request; explicit Revise repairs flow without reintroducing rejected edits. |
| A05 | Accept between ordinary typing operations, then Undo and Redo. | Exactly the current selected scope changes. Review/reflections dismiss on acceptance and restore with the original on Undo. Another pending review survives. |
| A06 | Pop a reflection or whole review; use Reject. | The document is unchanged. Popped thoughts do not enter future requests. R: accidental discard can be undone, and Reject matches main X behavior. |
| A07 | Open several reviews and interact with their source markers, thoughts, and outside document text. | One group expands at a time. Outside click minimizes; internal work does not. Compact markers remain on the right. R: minimized reviews clear their colored source decorations. |
| A08 | Insert before a target, edit part of it, or delete it completely. | Anchors track legitimate changes. Outdated proposals cannot be accepted. Complete target deletion pops the associated review, without mistaking repeated text or a view switch for deletion. |
| A09 | Accept a review that overlaps another; reopen the survivor. | Accepted text is not overwritten by an old candidate. The survivor refreshes against current source when needed, retaining its own thoughts. Exercise representative overlapping changes, including a shared insertion position when relevant to the implementation. |
| A10 | Reopen an outdated review repeatedly; reopen an unchanged review. | At most one refresh is in flight for that review. Unchanged reopening is local. Typing while minimized and switching views do not themselves generate. |
| A11 | Delay/fail a request; edit source or pop its review while waiting. | Revision controls use a clear disabled state. Late responses do not overwrite writing or revive popped reviews. Locks release on completion/failure and retry is explicit. |
| A12 | Switch Formatted/Markdown, edit in both modes, and Undo/Redo using headings, lists, links, emphasis, and fenced code. | One logical document and coherent history survive. Applicable review scopes/markings/choices stay associated; actual source edits trigger correct invalidation/deletion behavior. Handle incomplete syntax without silently losing content. A display-only switch makes no AI request or fake content changes. |
| A13 | Reload after writing thoughts and popping individual edits, including during generation. | Document and pending-review state recover coherently. A lost request is interrupted, not replayed. Popped thoughts do not silently reappear as instructions. |
| A14 | Use a long candidate, three reflections, nearby markers, screen edges, scrolling, and resize. | Source and controls remain readable and reachable. Bubbles do not overlap prose or imply a false anchor. Writing does not shift when groups open/minimize. Offscreen behavior must be deliberately resolved. |
| A15 | Use keyboard controls and pop a whole branch. | Labels/actions remain understandable without color or hover alone. R: one synchronized pop, mute, and reduced-motion feedback work without trapping focus. |
| A16 | Run a small live editing/refinement example, a provider error, and unavailable budget. | Actual integration works; concrete facts and requested tone are assessed on the example. Writing survives errors. An unchanged result triggers at most one corrective request (both counted) and is never installed; otherwise no automatic retry loop or false zero-cost report. |
| A17 | Follow README setup from a clean checkout and inspect submission contents. | App runs with documented configuration; genuine AI sessions are present and secrets absent. README accurately distinguishes finished features from known limitations. |
| A18 | Start fresh, create a document, open/drop a Markdown file, then return to saved work. | Minimal title/create/import opening leads into the editor. Imports stay local and do not generate. Saved work recovers without accidental replacement. Unsupported files produce a clear local error. |
| A19 | Generate in each mode, change modes, reload, and pop a charged review. | Fast/Smart route to allowlisted models; changing mode alone makes no request. Candidates retain producing-model identity. Actual cost and tracked spend are visible and deduplicated; popping/Undo does not erase charges. Unknown usage is not zero and the total is not misrepresented as account balance. |

Do not claim unexecuted behavior works or hide a known correctness failure. Fix critical scope/data-loss/history issues and report concrete limitations or necessary product trade-offs. Broaden validation for new changes, failures, or unresolved risks rather than a checklist quota.
