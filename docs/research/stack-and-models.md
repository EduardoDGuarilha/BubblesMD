> Supporting research, not the active build contract. Start with [the project README](../../README.md).

# Bubbles.MD: researched stack and model decisions

Prepared October 15, 2026. This resolves the technical choices Eduardo asked us to make. Preparation only: documentation and public source code were inspected; no application, editor prototype, or model evaluation was run. The original instruction not to start implementation remains in effect.

The final [build contract](<../../specs/001-bubbles-md/spec.md>) is the implementation entry point; this file supplies supporting research. Use its current visual/state defaults and staged delivery rather than assembling the historical planning files into a backlog.

## Selected baseline

| Area | Decision | Reason |
| --- | --- | --- |
| Client | React + TypeScript + Vite; ordinary CSS and React state initially | Fits the selected UI without adding routing, rendering, or state-management infrastructure prematurely. |
| Formatted editor | Tiptap with its Markdown extension and compatible ProseMirror packages | Structured editing, transaction mapping, and decorations suit selection-bound reviews. |
| Editable source | CodeMirror 6 with Markdown support | Source editing, change mappings, range decorations, and insertion widgets are available. It is a second view of the same logical document, not a second document. |
| API | ASP.NET Core 10 Minimal API in C#; typed DTOs, explicit validation, HttpClient, System.Text.Json | Fits Eduardo's experience and the .NET role; one small endpoint keeps credentials on the server. |
| Browser recovery | IndexedDB through idb-keyval | Store structured document/review state asynchronously as one coherent snapshot. |
| Smart mode / initial selection | `anthropic/claude-sonnet-5.5` | Quality-oriented starting choice; actual editing quality still needs measurement. |
| Fast mode | `anthropic/claude-haiku-5.5` | Lower published token rates; compare actual quality and latency before submission. |

These are selected implementation defaults, not claims that integration has passed. Eduardo's .NET correction supersedes the earlier Node/Express backend recommendation. Pin compatible dependency versions in the eventual lockfile. Keep one backend, a two-mode selector, and no database server or multi-document system.

## Editor validation: what the evidence establishes

[Tiptap Markdown](https://tiptap.dev/docs/editor/markdown) documents Markdown/JSON conversion, but labels the extension **beta** and lists limitations, including comments and table-cell structure. Its [editor API](https://tiptap.dev/docs/editor/markdown/api/editor) exposes Markdown parsing, serialization, and insertion. This establishes conversion capability, not a complete editable-source mode with cross-representation anchors.

[Tiptap position utilities](https://tiptap.dev/docs/editor/api/utilities/position) map positions through editor transactions and expose deletion information. [ProseMirror](https://prosemirror.net/docs/guide/) provides mapped transformations plus inline/widget decorations. These support source change outlines, insertion markers, and review anchoring within the structured document.

CodeMirror's official source confirms [position mapping and deletion modes](https://github.com/codemirror/state/blob/main/src/change.ts), [mark/widget decorations](https://github.com/codemirror/view/blob/main/src/decoration.ts), and [history effects](https://github.com/codemirror/commands/blob/main/src/history.ts). Its documentation site returned 403 to the research tool, so public upstream source was used instead.

**Neither library automatically supplies our combined document/review history or the mapping between Markdown offsets and formatted-editor positions.** Tiptap's [Undo/Redo](https://tiptap.dev/docs/editor/extensions/functionality/undo-redo) concerns editor history; CodeMirror's history integration points do not automatically merge the two editors' histories. Do not enable two independent authoritative Undo stacks and expect them to coordinate.

The first checkpoint must establish a single document/review transaction boundary, an explicit source/structured position bridge, and one coherent Undo route. Acceptance must pair the replacement with its review-state inverse. Preserve temporary source syntax; do not normalize source through repeated whole-document parse/serialize cycles while typing. Keep both view adapters subordinate to the same logical document and revision identity. The exact bridge/history implementation must be demonstrated in the checkpoint rather than claimed from API availability.

For the first build, support paragraphs, headings, emphasis, strong text, links, ordered/unordered lists, blockquotes, inline/fenced code, and thematic breaks. Verify the supported subset with fixtures. Preserve unsupported imported Markdown in source mode and clearly explain any formatted-mode limitation rather than silently dropping content. Arbitrary HTML, embedded components, and lossless conversion of every Markdown dialect are not promised.

MDXEditor was also inspected: it has a [built-in source/diff plugin](https://mdxeditor.dev/editor/docs/diff-source), and its [SourceEditor implementation](https://github.com/mdx-editor/editor/blob/main/src/plugins/diff-source/SourceEditor.tsx) creates a CodeMirror editor. That reduces source-view wiring, but does not by itself establish our combined review/history/anchor behavior. No runtime failure is alleged. Keep Tiptap as the baseline because our custom transaction/decorations requirements are central; revisit only after identifying a concrete failed gate.

The checkpoint remains: external reflection focus preserves selection; repeated text does not confuse targets; all three edit categories map; acceptance Undo/Redo restores review state; source edits and incomplete syntax survive mode switches; full target deletion pops the correct review. No AI is needed to test these.

## API and local recovery

Use one `POST /api/suggest` route for initial generation, refinement, and refresh. Build it in C# with [ASP.NET Core Minimal APIs](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/apis?view=aspnetcore-10.0), typed DTOs, explicit bounds/contract validation, HttpClient, and System.Text.Json. No Express, server-side Zod, or AI orchestration framework is needed. This fits Eduardo's existing .NET experience and the role better than introducing an unfamiliar backend runtime.

[Vite](https://vite.dev/guide/) builds the React/TypeScript client. Node/npm remain frontend development/build tools, not the application backend. Use a development proxy to the .NET API. For deployment, build the client into the API's static web assets before publishing, then [serve those files from ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/static-files?view=aspnetcore-10.0). The target is one published ASP.NET application with static frontend files and a server-side OpenRouter environment secret. It needs a .NET-capable host and outbound HTTPS, but no database service, Docker requirement, database connection string, or migration step. Verify this publish/start path during implementation; hosting has not been provisioned or tested.

Server environment variables hold the OpenRouter key and allowed mode-to-model mappings. The client sends only the Fast/Smart choice; the server resolves an allowlisted model rather than accepting arbitrary model IDs or URLs. Never expose the key through client build variables or browser persistence. A request contains captured review/source revisions, exact replacement scope, bounded surroundings, this review's active reflections, and applicable keep-original decisions. The model returns a replacement candidate or a typed unchanged/cannot-apply outcome; it cannot choose a new target or apply edits. Validate the response and recheck current source before enabling acceptance. UI diffing, popping, geometry, and view switching remain local.

[IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) supports asynchronous transactions and structured objects. [idb-keyval](https://github.com/jakearchibald/idb-keyval) provides a small promise-based wrapper. Save one versioned workspace snapshot containing the document representation needed for faithful recovery, revision identity, review anchors/base information, reflections, candidates, and individual edit choices. Serialize writes so an older save cannot replace a newer snapshot. Show Saved only after successful persistence; retain writing and report failures honestly.

Restore pending reviews minimized. Convert interrupted requests to an explicit retry state; loading must not spend tokens. Full Undo history across reloads remains outside the selected scope. Browser storage is local recovery, not a backup guarantee; retain a normal Markdown download/export path. No account or server database is needed.

IndexedDB runs inside the browser: idb-keyval is bundled client code, with nothing to install or deploy as a database. We choose it over synchronous localStorage because the workspace contains structured pending-review state as well as prose. It remains scoped to the browser profile and site origin; localhost and a hosted URL have separate saves. Clearing site data or browser eviction can remove it, so Markdown export remains available. This is a local-recovery trade-off, not a promise of account sync or permanent cloud storage.

## Model research and decision

Current OpenRouter availability and published input/output rates were checked on October 15, 2026. Rates below are per million tokens for short contexts, before caching or other adjustments.

| Model ID | Input | Output | Role |
| --- | --- | --- | --- |
| [anthropic/claude-sonnet-5.5](https://openrouter.ai/anthropic/claude-sonnet-5.5) | $2.00 | $10.00 | Smart mode, initial selection and quality reference. |
| [anthropic/claude-haiku-5.5](https://openrouter.ai/anthropic/claude-haiku-5.5) | $0.10 | $0.50 | Fast mode, economy option. |
| [openai/gpt-5.6-luna](https://openrouter.ai/openai/gpt-5.6-luna) | $0.20 | $1.20 | Researched alternative if the first comparison exposes a concrete need. |

[Anthropic's Sonnet overview](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) corroborates $2/$10 pricing; its [Haiku overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview) describes a faster, cost-sensitive tier. [OpenRouter's catalog](https://openrouter.ai/api/v1/models) lists structured-output parameters for these candidates. Availability in the catalog does not establish that a particular provider route or supplied account accepts every setting; check the chosen route during integration. Do not assume settings for one model work unchanged on another. In particular, avoid arbitrary temperature parameters and validate supported reasoning/output controls.

Choosing Sonnet first is an engineering judgment, **not a published finding that it is best at Bubbles.MD**. It gives us a quality reference while requests remain small. A 2,000-input/1,000-output-token example costs approximately $0.014 with Sonnet, $0.0007 with Haiku, or $0.0016 with Luna at these rates. These examples exclude additional billable reasoning tokens, retries, and provider adjustments; they are not guaranteed per-request totals. Record actual returned usage/cost where available, including reasoning, and keep the supplied $5 cap authoritative.

Our context is a selected passage, nearby prose, and a few reflections; a million-token context window is not a reason to send the document or conversation history. Begin with one in-flight request, bounded inputs/output, no automatic retries, and low reasoning effort only where the actual route supports it. Keep model configuration server-side. Do not silently switch models on failure or add a routing agent.

### User-selected Fast/Smart control and visible cost

Eduardo explicitly wants a choice between a faster/cheaper mode and a more capable/pricier mode, with spending visible. Add a compact Fast / Smart selector near the generation controls. Fast maps to Haiku and Smart to Sonnet initially. These labels describe the intended trade-off; they do not prove measured latency or superior output on every request. Show the underlying model and published rates in a small details/tooltip view.

Capture the selected mode/model with each request. Switching changes future generation/refinement only, does not spend tokens, and does not discard or silently regenerate an existing candidate. Keep generation controls disabled during an active request. Retain the producing mode/model with the candidate so the displayed provenance stays accurate after a mode switch.

Show the actual request cost beside each completed suggestion and a persistent, compact tracked-spend total near the selector. A details view can show input/output/reasoning tokens and the actual returned model. Preserve a lightweight deduplicated request ledger locally, separate from review deletion/Undo, so popping a bubble cannot erase its spend. No analytics dashboard is needed.

Use OpenRouter's returned `usage.cost` for charged cost; its [usage accounting documentation](https://openrouter.ai/docs/cookbook/administration/usage-accounting) states that responses include token and cost information. Do not substitute upstream provider cost for the account charge. If showing an estimate before generation, label it Estimated and account for output/reasoning uncertainty. Missing or interrupted usage is Unknown/Pending, never a fabricated $0. A tracked total covers only recorded app requests, not the account's complete balance; the provider key's supplied cap remains the authoritative $5 backstop. Do not claim a browser counter enforces an account-wide budget.

This implements relevant company principles through owned context, explicit model choice, visible actual spend, bounded requests, and local review control. It does not require an automatic model router or enterprise governance product.

### What credible writing research contributes

The reviewed abstracts and published descriptions of [EditEval](https://arxiv.org/abs/2209.13331) and [WritingBench](https://arxiv.org/abs/2503.05244) are directly relevant to evaluation design:

- EditEval distinguishes instruction-based text improvement from ordinary generation, including cohesion, paraphrasing, and factual updating. It reports disagreement among editing metrics and prompt robustness across models. Its older model results cannot rank today's candidates.
- WritingBench evaluates writing across domains with request-dependent criteria covering matters such as style, format, and length. Broad writing evaluation still differs from our exact selected-span, multi-step review workflow.

Neither reviewed source establishes a current winner for our three model IDs or tests Bubbles.MD's retained reflections/pop choices. Coding and general intelligence scores shown on model pages do not answer that question either. Use this research to construct task-relevant checks rather than claim an unsupported leaderboard victory.

### Bounded evaluation when implementation is authorized

Prepare twelve fixed cases: grammar with minimal edits; clarity; shortening with a length constraint; tone; factual names/numbers preserved; Markdown links/emphasis; lists/headings; fenced code preservation; refinement retaining prior intent; keep-original constraints after a pop; conflicting thoughts without invented facts; and a long selection with surrounding context outside editable scope.

Compare Sonnet and Haiku on identical inputs, with a human judging useful writing, intent adherence, and unnecessary changes. Reject outputs that change protected facts, violate the replacement contract, or override keep-original choices. Record success, latency, actual tokens and cost; assess cost per usable result. Do not rely on lexical overlap or another model's opinion alone.

Use a recommended initial live-evaluation ceiling of $0.50 within the $5 total; do not run it during preparation. Use fixtures for the application mechanics and provider-error simulations. Compare both exposed modes; if Haiku provides comparable useful quality at lower observed cost/latency, it can become the initial selection while Smart remains available. Otherwise retain Smart initially and document the concrete trade-off. Luna is a targeted next experiment, not a third mode or mandatory benchmark round. There have been no live calls or measured model results yet.

## Opening experience chosen by Eduardo

A fresh visit shows **Bubbles.MD**, a pleasing bubble action to create a blank document, and one clear file-selection/drop area to open a Markdown file. Clicking the area opens the native file picker; dragging a supported file uses the same import path. Then show the editor. Avoid an onboarding wizard, dashboard, account screen, or separate library.

File reading is local and makes no model request. Initially accept Markdown text files; do not imply PDF/Word conversion. A returning saved workspace restores the editor under the existing recovery decision. Protect that workspace from accidental replacement when creating or importing another document. Keep the opening screen visually consistent with the connected-bubble aesthetic.

## Next step

Use the updated [Claude checkpoint prompt](<../../START_HERE.md>) to start only when Eduardo chooses to begin implementation. The editor checkpoint is the next evidence needed; additional speculative stack research is unlikely to reduce rework as much as testing that integration.
