# Bubbles.MD build sequence

Status: implemented (see README and docs/progress.md for what was verified). This sequence preserves the full spec/design/plan; it simplifies execution, not product scope.

Once Eduardo authorizes the local build, continue through these steps without another approval for each step. Interleave work when it advances a working product, and report a concrete blocked essential requirement or necessary scope trade-off. Keep one application throughout.

## 1. Establish the foundation and a working AI slice early

- [x] Verify genuine session capture; state a concise document/review ownership and history/mapping approach.
- [x] Create the runnable editor, capture a real selection, and exercise formatted/Markdown editing plus exact-scope acceptance and Undo with a small fixed candidate.
- [x] Add the C# endpoint and connect selection -> first reflection/Enter -> real candidate/diff -> accept/reject/refine. Show actual request cost.
- [x] Confirm a useful real suggestion early. Extend the source/history integration alongside that working slice; do not postpone AI until every local feature or editor edge case is finished.

Use a focused experiment for the hardest integration. Do not build dependent UI around a known broken source/history model, but independent API work need not wait for an exhaustive editor test matrix.

## 2. Complete the selected product

- [x] Complete individual pops, reflection changes, several right-side reviews, minimization, stale/overlapping review handling, coherent Undo, and safe request lifecycle.
- [x] Complete editable Markdown behavior, local recovery, create/import/export, Fast/Smart selection, model provenance, and accurate tracked spending.
- [x] Finish measured bubble positioning, paired hover/focus, long/offscreen/narrow states, sound/mute, and keyboard usability against design.md.

All selected capabilities remain in scope. Implement them incrementally; do not invent additional product infrastructure. A deadline-driven scope change requires a concrete proposal to Eduardo.

## 3. Verify and hand over

- [x] Run focused automated checks for the risky edit/history logic and add cases justified by concrete risks or bugs.
- [x] Walk through the real writing journey, Markdown/recovery journey, and representative stale/failure behavior. Inspect the actual visual experience.
- [x] Try a few representative real editing/refinement examples across both model modes; record actual usage within the supplied budget.
- [x] Run builds and a fresh startup/setup check, verify local ASP.NET publishing, and complete an accurate README, genuine sessions, and secret-free submission contents.

See [acceptance.md](acceptance.md) for verification guidance and [release.md](checklists/release.md) for the final checklist. The A01–A19 catalog describes behavior; it does not require a separate automated test, report, or exhaustive permutation for each row.

Keep [progress.md](../../docs/progress.md) short: what works, checks actually run, remaining issues, and next task. Protect time for delivery verification. Repository publication, public deployment, and sending the submission remain separately authorized actions.
