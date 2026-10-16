# Bubbles.MD technical implementation plan

Status: selected architecture, unproven integration. No application work has been run. See [tasks.md](tasks.md) for authorized phase boundaries and [acceptance.md](acceptance.md) for proof.

## Selected stack

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

## State, source mapping, and history

Use one app-owned document/review revision boundary. Select an explicit source/structured position bridge and shared history strategy at the first checkpoint. Tiptap and CodeMirror are adapters; do not maintain unrelated authoritative document copies or independent Undo histories. View switching is local, creates no synthetic edit, and never generates. Preserve the same logical change identities in both modes; syntax exposed by switching to Markdown is not a new AI edit, while actual proposed formatting changes must remain discernible. Preserve incomplete Markdown while typing. Review decorations must not appear in exported Markdown.

Support paragraphs, headings, emphasis/strong, links, lists, blockquotes, inline/fenced code, and thematic breaks first. Preserve unsupported imported content in source mode and explain formatted-mode limitations. Do not silently remove unsupported content. Render user/model Markdown safely: no executable raw HTML or unsafe link schemes. The editor engine remains a library, not a custom contenteditable implementation.

Use [contracts/suggest-api.md](contracts/suggest-api.md) for the endpoint boundary.

## Persistence, models, and spending

Persist one versioned browser snapshot with document/source recovery data, stable reviews/anchors, candidates, thoughts, keep-original choices, preferences, and compact request/decision accounting. Serialize writes; show Saved only after completion. Recovery releases loading locks and marks unfinished requests Interrupted. Do not auto-replay them. Storage failure must leave the document usable and exportable. Browser recovery is scoped to a profile/site origin; full Undo history across reloads and cloud sync are excluded.

Fast initially maps to `anthropic/claude-haiku-5.5`; Smart to `anthropic/claude-sonnet-5.5`, initially selected. Changing mode affects future calls, not existing candidate provenance or text. Details show underlying model/rates. Show actual request cost and tracked app spend; unknown cost is not $0. Preserve accounting independently of review deletion/Undo and deduplicate by request ID. It is not the account balance. Retain a compact real decision status (pending/accepted/rejected/invalidated/undone) with request/model/revision metadata behind existing details, not a new archive/dashboard. Local records are not immutable compliance logs.

Keep the provided $5 key cap authoritative. Plan at most $0.50 initially for live evaluation within that total. Use a few representative real examples to check both modes, intent/facts, and refinement; the twelve cases in [the research](../../docs/research/stack-and-models.md) are an optional case bank, not a required matrix. Use local fixtures for mechanical/error checks. Record actual model, useful quality, latency, and returned usage. Neither price nor a generic coding score proves writing quality.

## Planned code and deployment layout

- `src/client/`: React, TypeScript, Vite, editor adapters, review state, UI, and IndexedDB recovery.
- `src/server/`: C#/ASP.NET Core API, typed request validation, OpenRouter integration, and static client hosting.
- Place tests next to the relevant modules or in focused test projects; choose routine details during implementation.
- Build the client into server static assets before publishing. Verify the local published application rather than assuming deployment works.
- No runtime database service or migrations. Server secrets stay outside client assets and repository contents.

## Server-only provider credential

Use standard backend secret configuration. When ready, Claude provides Eduardo the command to set a Windows user environment variable outside chat and retrieves its current user-scoped value from the registry as needed. Variable naming, .NET binding, and normal setup details belong to implementation; no special launch/restart procedure is prescribed here. Keep the key out of frontend bundles, committed files, logs, and transcripts.

## Early foundation experiment

Explain document/review ownership and the source/history approach, then exercise exact targeting, basic formatted/Markdown editing, and acceptance Undo with a small fixed candidate. Establish this foundation and a minimal real C# / AI writing flow early; complete remaining editor behavior incrementally.

Do not build dependent functionality around a known broken source/history design. Independent API work and a useful thin writing flow need not wait for every editor variation, persistence feature, or visual finish. Explain a concrete blocked essential requirement or necessary scope trade-off. Verification follows [acceptance.md](acceptance.md), without an exhaustive matrix or automatic pause after each step.
