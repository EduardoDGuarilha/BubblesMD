# Bubbles.MD

A Markdown editor that turns your reflections about a selected passage into a reviewable alternative. Select text,
think out loud in connected thought bubbles beside it, and review the AI's proposal as a software-computed diff. Pop
the individual edits you don't want, add reflections to refine it, then **Accept** it as one undoable step or
**Reject** it. Nothing in your document changes until you accept.

Built for the Chiri engineering assessment. The client is React + TypeScript (Vite, Tiptap, CodeMirror 6). The
server is a C# / ASP.NET Core 10 Minimal API that keeps the OpenRouter key server-side.

## The interaction

1. **Select** a passage and press **+ Bubble** (it appears just above the selection), or press Ctrl/Cmd+Alt+M.
2. **Reflect.** Write what should change in the first thought bubble. Enter submits it; Shift+Enter adds a line.
   Selecting, creating and typing never call the model.
3. **Review.** The suggestion bubble holds exactly the replacement for your selection, compared with the original:
   - added text is green, with a green **+** at the insertion point in your document;
   - altered wording is yellow on both sides;
   - deleted wording is outlined in red in your document, with a red **−** at the deletion point in the suggestion.

   Hovering a change highlights both sides together.
4. **Pop** any single change by clicking it on either side. It falls back to the original wording in the proposal, and
   the document stays untouched.
5. **Refine** by submitting another reflection; an updated suggestion is requested from all your reflections and your
   pops. **Try again** regenerates explicitly.
6. **Decide.** Accept replaces only that passage, as one undoable step. Reject discards the review.

Several reviews can be pending at once. Minimized ones sit as small ••• bubbles beside their passages.

## Demo

https://github.com/user-attachments/assets/4d4a31f4-1e0b-416c-8c9f-35e9b2124706

[Download the demo](docs/demo/bubbles-md-demo.mp4) (74 s, 1080p, 2.8 MB; compressed from the original screen recording).

> While demonstrating Bubbles.MD to a friend using a Harry Potter fanfic, I asked it to replace a mention of Harry
> with his best friend's name. I hadn't noticed that Hermione was also mentioned in the paragraph.
>
> Instead of simply substituting Ron Weasley, the app declined the edit and explained the ambiguity. It caught
> something I had overlooked in my own instruction.
>
> The video also shows how additional reflections guide a suggestion and how individual changes can be popped. For
> me, the unexpected refusal illustrates the same principle: context should help expose uncertainty, while the writer
> keeps control of the final decision.
>
> I kept this unscripted demo because that moment felt a little magical, no pun intended. :)

*Recorded before the final scrolling correction. The scroll-position bug visible in this video has since been fixed.*

## Run it

Prerequisites: .NET SDK 10, Node.js 20.19+ with npm, and an OpenRouter key. The commands below were used on Windows.

1. **Configure the key (once).** In your own PowerShell terminal (the key is not echoed or stored in history):

   ```powershell
   $k = Read-Host 'OpenRouter key' -AsSecureString; [Environment]::SetEnvironmentVariable('OPENROUTER_API_KEY', [Net.NetworkCredential]::new('', $k).Password, 'User')
   ```

   On Windows the server reads the current user-scope value from the registry on each request, so no restart is
   needed. Elsewhere, set `OPENROUTER_API_KEY` in the server's environment.

2. **Build and run the published app:**

   ```powershell
   pwsh -File scripts/build.ps1
   dotnet publish/BubblesMd.Server.dll --urls http://localhost:5180
   ```

   Open http://localhost:5180. `scripts/build.ps1` runs `npm ci`, builds the client into the server's `wwwroot` and
   publishes to `./publish`. There is no database, Docker or migration step.

**Development mode** (hot reload), in two terminals:

```powershell
dotnet run --project src/server/BubblesMd.Server --launch-profile http   # API on http://localhost:5180
npm --prefix src/client install; npm --prefix src/client run dev         # UI on http://localhost:5173 (proxies /api)
```

**Zero-cost fixture mode.** Append `-- --Bubbles:Provider=fake` to the `dotnet run` command. The fake provider
deterministically alters, deletes and adds words. Reflection keywords trigger edge cases:
- `#slow`, `#fail`, `#malformed`;
- `#unchanged`, `#cannot`, `#delete`;
- `#same` (a real change only after the correction), `#stubborn` (no change even after it);
- `#newline` (a stray trailing line break).

**Tests:** `npm --prefix src/client test` (Vitest, 45 tests) and `dotnet test src/server/BubblesMd.slnx` (xUnit, 14
tests).

## How it works

- **Frontend (React + TypeScript).**
  - **Editors.** Two views edit the same document: Formatted (Tiptap) and Markdown (CodeMirror 6).
  - **Store.** A small store owns all state; React renders it.
  - **Review space.** Bubble placement, clusters and connector dots are computed from measured geometry
    (`core/geometry.ts`). The expanded review stays in view with CSS `position: sticky`.
- **Backend (C# / ASP.NET Core 10).**
  - `POST /api/suggest` validates request bounds, builds the prompt, calls OpenRouter and validates the model's
    structured answer.
  - `GET /api/config` lists the modes and their rates.
  - The published build serves the client too.
- **Document ownership.** The store owns one canonical Markdown string; both editors are adapters.
  - CodeMirror reports exact change sets. Tiptap edits are serialized and diffed against the previous Markdown.
  - Undo, redo and Accept are applied back to the editors as minimal replacements.
  - Neither editor's own history is used. One app-level history covers the document text plus each review's anchor,
    reflections, active suggestion version and pops.
  - Suggestion versions are immutable and cached outside that history, so Undo/Redo never re-requests anything.
  - Spending is never undone.
- **Review safety.**
  - **Anchors.** A review's scope is a Markdown range, mapped through every edit.
  - **Staleness.** A suggestion can be accepted only while its captured passage and ±120 characters around it are
    unchanged. Otherwise it is marked outdated and refreshed once when reopened.
  - **Overwrites.** Deleting a passage entirely pops its review (undoable). Overwriting only one edge blocks the review
    until you retarget it.
  - **Requests.** One request runs at a time across the app. A late or cancelled result is ignored, but its cost is
    still recorded. After a reload, an unfinished request shows as "Interrupted" and is never replayed.
  - **Diff and Accept.** The diff is computed by ordinary code (token-level, jsdiff), not by the model. Accept applies
    the non-popped changes to exactly the reviewed range.
- **OpenRouter integration.**
  - **Modes.** Fast (`anthropic/claude-haiku-5.5`) or Smart (`anthropic/claude-sonnet-5.5`, the default). The server
    maps the mode to an allowlisted model; the browser never sends a model id or key.
  - **Request and answer.** Chat completions with a JSON-schema answer (`replace`, `unchanged` or `cannot_apply` with
    a reason), 8,000 max output tokens and a 90 s timeout. Truncated, malformed or unsafe output is rejected.
  - **No-change correction.** If a result makes no change, the server makes exactly one corrective call, and both calls
    are reported. There are no other retries or model fallbacks.

## Context, approval and spending

- **What the model sees:**
  - the selected Markdown (up to 16,000 characters);
  - up to 2,000 characters before and after it;
  - your reflections (marked new or earlier);
  - for refinements, the current proposal with your pops applied, plus your keep-original choices.

  Document text is placed inside per-request random fences and described as content, not instructions. That reduces
  the risk of text in a document steering the model; it does not rule it out.
- **Human approval.** The model only proposes a replacement for the captured range. Your document changes only when
  you press Accept, and Accept can be undone. The model may also decline (`cannot_apply`) and explain why, as in the
  demo.
- **Spending.**
  - Each suggestion shows its model and the actual cost OpenRouter returned (`usage.cost`), with token counts and
    latency in its details.
  - The toolbar total sums the tracked calls made by this app in this browser. It is not your OpenRouter balance.
  - A cost that wasn't returned is shown as unknown, never as $0.
- **Local data.**
  - Documents, reviews and the spending record live in this browser's IndexedDB.
  - Nothing is stored on the server; only suggestion requests leave the browser.
  - This is local recovery, not a backup: use **Export .md** to keep a document.

## Known limitations

- **Possible model mistakes.**
  - The no-change check is textual: it proves the text changed, not that it improved.
  - A refinement can reword more than asked. The diff shows it, and each change can be popped.
- **Mid-word selections.** A selection that cuts through a word is sent as-is, and the model may produce an awkward
  join; check the diff before accepting.
- **Formatted view coverage.**
  - Formatted view edits paragraphs, headings, emphasis, links, lists, quotes, code and rules.
  - Tables, raw HTML, images and link definitions make it read-only, with a pointer to Markdown view.
  - Editing there writes standard Markdown syntax (for example `__a__` becomes `**a**`).
- **Large documents.** Very large documents are serialized and diffed on every Formatted-view keystroke. This is fine
  for typical documents but untested near the 1 MiB import limit.
- **Inline marking fallback.** In rare cases a change can't be highlighted inline without altering how its Markdown
  renders (for example punctuation added right against `**[link](…)**`). It is then listed under the suggestion as
  "Not marked inline", still paired with the source and poppable.
- **Connector dots while scrolling.** The dots between passage and suggestion are redrawn by JavaScript, so they can
  trail by a frame during very fast compositor scrolling; the suggestion itself cannot. With a crowded cluster near a
  viewport edge, the connection may be omitted rather than drawn through other bubbles.
- **Recovery scope.** Undo history doesn't survive a reload; the document and pending reviews do. Recovery is per
  browser and site origin.
- **By design:** no accounts, sync, collaboration or server-side storage.

## With more time

- A Playwright suite for the browser journeys that were checked by hand.
- A wider Fast-vs-Smart evaluation on a fixed set of editing tasks.
- Block-level incremental serialization for large documents, and code-splitting the editor bundle.

## Development record

- **[AI development sessions](docs/ai-sessions/README.md):** the genuine Claude Code conversations, exported with the
  app's own export, with the redactions listed there.
- **[Verification log](docs/verification-log.md):** what was checked in each development pass, with measurements and
  the defects found and fixed.
- **[Build notes](docs/progress.md):** a short chronological log.
- **[Product specification](specs/001-bubbles-md/spec.md), [design](specs/001-bubbles-md/design.md) and
  [plan](specs/001-bubbles-md/plan.md):** the decisions this build follows.

## Repository layout

- `src/client/`: React app.
  - `core/`: document, anchor, diff, bridge, history and geometry logic, with tests.
  - `editor/`: Tiptap and CodeMirror adapters.
  - `state/`: the store and request lifecycle, with tests.
  - `ui/`: bubbles, toolbar and landing page.
- `src/server/`: the ASP.NET Core API (`BubblesMd.Server`) and its tests (`BubblesMd.Server.Tests`).
- `specs/001-bubbles-md/`: product specification, design, plan and acceptance guidance.
- `docs/`: development records, plus `docs/demo/` and `docs/research/`.
- `samples/pilot-plan.md`: a sample document.

## Credits

- **Pop sound:** [Bubble Pop 02](https://pixabay.com/sound-effects/film-special-effects-bubble-pop-02-293341/) by
  Universfield, supplied by Eduardo and used for the app's pop
  interaction under the [Pixabay Content License](https://pixabay.com/service/license-summary/).
  See [third-party notices](THIRD_PARTY_NOTICES.md) for the asset path and license references.
