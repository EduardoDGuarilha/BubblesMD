# Bubbles.MD

A Markdown editor that turns your reflections about a selected passage into a reviewable alternative. Select text,
think out loud in connected thought bubbles on the right, and review a software-computed diff of the AI's proposal.
Pop individual edits, refine with more reflections, then **Accept** (one undoable step) or **Reject**. Nothing in
your document changes until you accept.

Built for the Chiri engineering assessment: React + TypeScript (Vite, Tiptap, CodeMirror 6) client and a C# /
ASP.NET Core 10 Minimal API that keeps the OpenRouter key server-side.

## Run it

Prerequisites: .NET SDK 10, Node.js 20.19+ (npm), and an OpenRouter key.

1. **Configure the key (Windows, once).** In your own PowerShell terminal (the key is not echoed and not stored in history):

   ```powershell
   $k = Read-Host 'OpenRouter key' -AsSecureString; [Environment]::SetEnvironmentVariable('OPENROUTER_API_KEY', [Net.NetworkCredential]::new('', $k).Password, 'User')
   ```

   On Windows the server reads the current user-scope value from the registry on every request, so no restart is
   needed. Elsewhere, set `OPENROUTER_API_KEY` in the server's environment. The key never reaches the browser, logs
   or repository files.

2. **Build and run the single published app:**

   ```powershell
   pwsh -File scripts/build.ps1
   dotnet publish/BubblesMd.Server.dll --urls http://localhost:5180
   ```

   Open http://localhost:5180. `scripts/build.ps1` runs `npm ci`, builds the client into the server's `wwwroot`, and
   `dotnet publish`es to `./publish` (no database, Docker or migrations).

**Development mode** (hot reload), in two terminals:

```powershell
dotnet run --project src/server/BubblesMd.Server            # API on http://localhost:5180
npm --prefix src/client install; npm --prefix src/client run dev   # UI on http://localhost:5173 (proxies /api)
```

**Zero-cost fixture mode:** start the server with `--Bubbles:Provider=fake`. The fake provider deterministically
alters, deletes and adds words. These reflection keywords drive failure cases: `#slow`, `#fail`, `#malformed`,
`#unchanged`, `#cannot`, `#delete`.

**Checks:** `npm --prefix src/client test` (Vitest) and `dotnet test src/server/BubblesMd.slnx` (xUnit).

## Using it

- **Start:** create a document or open/drop a `.md` file (≤ 1 MiB, read locally; nothing is sent anywhere). Saved
  work in this browser reopens automatically. New/Open on an existing document asks before replacing it, and offers
  Export first.
- **Ask:** select text, then press **+ Bubble** (or Ctrl/Cmd+Alt+M) and write a reflection. Enter submits the first
  reflection; Shift+Enter adds a line. Selecting, creating and typing never call the model.
- **Review:** the candidate contains exactly the replacement for your selection.
  - Yellow marks altered wording, red marks deleted wording, and a green **+** marks added text.
  - Hover or focus any change to pair the source and candidate sides.
  - Click a change on either side, or press Enter on it, to **pop** it: that edit falls back to the original wording.
- **Refine:** add or edit reflections (Enter commits them locally; "Thoughts changed" appears), then **Suggest**.
  Popped edits are sent as explicit "keep original" choices.
- **Decide:** Accept replaces only that passage, as one undoable step. Reject or × discards the review and leaves the
  document unchanged.
- **Navigate:** Escape or a click outside minimizes the review to a ••• marker beside its passage. Undo/Redo
  (toolbar, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) restores document, reviews, reflections and pops together.
- **Views:** switch between **Formatted** (Tiptap) and **Markdown** (CodeMirror) at any time. It is one document;
  switching never edits or generates.
- **Model and cost:** pick **Fast** (`anthropic/claude-haiku-5.5`) or **Smart** (`anthropic/claude-sonnet-5.5`,
  default).
  - Each suggestion shows its model and actual cost; details show tokens, latency, request and decision status.
  - The toolbar total is the tracked spend for this app's requests in this browser, not your OpenRouter balance.
  - Unknown cost is shown as unknown, never as $0.

## How it works

- **One canonical document.** The app store owns a single Markdown string. Both editors are adapters:
  - CodeMirror reports exact change sets.
  - Tiptap edits are serialized with `@tiptap/markdown` and diffed against the previous Markdown, using the
    transaction's position as a hint so typing at a boundary is attributed correctly.
  - External changes (undo, redo, accept) are applied to Tiptap as a minimal document replace.
  - Neither editor's own undo history is used.
- **Position bridge.** `core/bridge.ts` aligns ProseMirror text positions with Markdown offsets for selection
  capture, decorations and bubble geometry.
  - It skips block syntax, masks link destinations and decodes entities.
  - It fails loudly rather than guessing when alignment is impossible.
  - Content Formatted view cannot represent (tables, raw HTML, images, link definitions) makes that view read-only,
    with a pointer to Markdown view.
- **Anchors and staleness.**
  - Review scopes are Markdown ranges, mapped through every edit; insertions at a boundary stay outside the scope.
  - Fully deleting a target pops its review (undoable). An edit that overwrites only one boundary blocks the review
    until you **Retarget** it.
  - A candidate is actionable only while its captured source and ±120 characters of context are unchanged.
  - Reopening an outdated review refreshes it once; failures need an explicit Retry.
- **History.** Snapshot history covers the document text plus each review's status, anchor, reflections, active
  candidate version and pops.
  - Candidate payloads are immutable versions cached outside history, so Undo/Redo restores the matching version with
    its own pops and never re-requests anything.
  - Spending is never undone.
- **Diff.** A deterministic token-level diff (jsdiff) groups adjacent removals and insertions into altered / added /
  deleted changes with stable ids. Accept applies the non-popped groups to the exact scope.
- **Requests.**
  - One request is in flight across the app; others show Busy and nothing is queued.
  - × cancels a request; a late result is ignored but its cost is still recorded.
  - On reload, an unfinished request becomes "Interrupted" and is never replayed.
- **Server.** `POST /api/suggest` validates bounds (16,000 selected characters, 4,000 context, 8,000 reflection
  characters, 256 KB body).
  - It fences document text with per-request random markers, so text inside the document cannot pose as
    instructions.
  - It calls OpenRouter chat completions with a JSON-schema outcome (`replace` / `unchanged` / `cannot_apply`),
    8,000 max output tokens and a 90 s timeout.
  - It rejects truncated, malformed or unsafe output, and returns `usage.cost` (null when absent).
  - There are no automatic retries or model fallbacks. `GET /api/config` lists modes and rates.
- **Persistence.** One versioned snapshot is stored in IndexedDB (idb-keyval) with serialized writes. "Saved" shows
  only after a write completes; a failed write shows "Not saved" and keeps the document usable and exportable.

## Storage and limits

- Recovery is per browser profile and site origin (`localhost:5173` and `localhost:5180` keep separate saves).
  Clearing site data removes it, so use **Export .md** for anything you need to keep.
- Undo history does not survive a reload (by design); the document and pending reviews do.
- Formatted view supports paragraphs, headings, emphasis/strong/strike, links, lists, blockquotes, inline/fenced code,
  hard breaks and rules.
  - Editing there writes standard Markdown syntax (e.g. `__a__` becomes `**a**`); a notice says so when it applies.
  - Line endings are normalized to `\n` on import.

## Verification performed

Automated:
- **Vitest (16):**
  - Bridge fixtures on real Tiptap parse/serialize: repeated words, link text equal to its URL, nested and ordered
    lists, Markdown-looking code, cross-block selections, loud failure.
  - Repeated-wording targeting, far edits vs. nearby-context staleness, refusal of stale Accept, late results after
    discard, full-deletion pop with undo, boundary-straddling block.
  - Undo/Redo version linkage: pop on v1 → refine to v2 → Undo restores v1 with its pop and thoughts → Redo restores
    v2 from cache with no request and unchanged spend; Accept → Undo while another review survives.
  - Diff grouping and losslessness.
- **xUnit (9):** request bounds, outcome parsing with actual cost, unknown cost, empty replacement, truncated /
  malformed / unsafe output, 402/429 mapping, prompt fencing and keep-original records.

Walked through in the in-app browser:
- Import; select → + Bubble → reflection → candidate; pop from source and from candidate; Accept → Undo/Redo;
  outside-click and Escape minimize.
- Markdown view decorations, Accept there and Undo after switching back.
- Reload recovery, and reload during generation (Interrupted, no replay).
- Busy, edit-during-generation (installed as outdated), provider failure with Retry, cancel during generation,
  Retarget, and keyboard pop.
- Layouts: 1440×900, 1024×768, 1280×560 (offscreen source and a long three-reflection family) and 390×844.
- The published app started from `./publish` and served UI, API and SPA fallback.

Live OpenRouter calls: five completed for $0.0135 actual (returned `usage.cost`), plus one interrupted by a reload
with unknown cost, well within the $5 key cap.
- **Smart:** initial ($0.0044, 5.1 s) and refine respecting a popped keep-original choice and a two-sentence request
  ($0.0085, 314 reasoning tokens).
- **Fast:** outdated refresh ($0.00036, 3.8 s), a grammar/tone fix on the published build that kept the facts
  ($0.00015), and the same mid-word selection after the prompt fix, which now continues the fragment correctly
  ($0.00015).

## Known limitations

- Very large documents are serialized and diffed on every Formatted keystroke; this is fine for typical documents and
  untested near the 1 MiB import limit.
- A selection that cuts through a word is sent as-is. The prompt now states mid-word boundaries; this fixed the one
  observed case, but a model can still produce an awkward join, so check the diff before accepting.
- Pairing lines are drawn for the first line of a multi-line change only.
- The pop sound uses Web Audio and may be silent until the page has had a user gesture.
- No accounts, sync, multiplayer or server storage (by design). Browser storage is local recovery, not a backup.

## With more time

- A Playwright end-to-end suite for the browser journeys walked through manually above.
- A broader evaluation of Fast vs. Smart on the twelve-case bank in `docs/research/stack-and-models.md`.
- Optional reasoning-effort control per mode.
- Incremental (block-level) serialization for very large documents.
- Code-splitting the editor bundle.

## Repository layout

- `src/client/`: React app.
  - `core/`: pure document, anchor, diff, bridge and history logic, with tests.
  - `editor/`: Tiptap and CodeMirror adapters.
  - `state/`: store and request lifecycle, with tests.
  - `ui/`: bubbles, toolbar, landing.
- `src/server/`: ASP.NET Core API (`BubblesMd.Server`) and tests (`BubblesMd.Server.Tests`).
- `specs/001-bubbles-md/`: product spec, design, plan and acceptance guidance this build follows.
- `docs/progress.md`: build notes. `docs/ai-sessions/`: genuine development session exports.
- `samples/pilot-plan.md`: a sample document.
