# Genuine AI development sessions

Bubbles.MD was built with Claude Code in the Claude desktop app (Code tab), using Claude Opus 5.5 as a single
reasoning agent without subagents.

The files here come from the app's native transcript export: the session menu's Export, run through the app's
`export_transcript` tool. They are the actual conversations: the real prompts and responses, the plans that were
rejected or revised, the corrections and the failed attempts. Nothing was reconstructed or summarized.

## Sessions

| File | Session | Contents |
|---|---|---|
| `2026-10-15-implementation-session.zip` (13 MB) | Main implementation session | The whole build: the build prompt, plans and their revisions, implementation, every correction pass, and this packaging step. |
| `2026-10-16-fork-change-marking-investigation.zip` (9 MB) | Fork of the main session | Investigation of the reported change-marking screenshots (grouping and Markdown rendering). Read-only: nothing was changed. |
| `2026-10-16-fork-selection-scroll-investigation.zip` (10 MB) | Fork of the main session | Investigation of the scroll jump on creation, the missing "+ Bubble" and the scrolling jitter. Read-only: nothing was changed. |
| `2026-10-15-interrupted-start-1.zip`, `-2.zip` (0.1 MB each) | Two short separate sessions | The build prompt pasted, one or two commands run, then interrupted by the author before the main session started. Kept for completeness. |

**About the main session:**
- It ran long enough for the app to compact the context once. The compaction appears in the transcript as a summary
  message; everything before it is still in the file, and the session continues after it.
- It was exported near the end of packaging, so the closing report message after the packaging commit is not
  included. Re-export it from the session menu to capture that turn.

**About the forks:**
- The author created them from the main conversation to investigate reported defects in parallel.
- A fork's transcript starts with the parent conversation up to the fork point (so that part repeats the main
  session), followed by its own investigation.
- Each fork's report was read back into the main session, which implemented the fixes.

Times are recorded in UTC. The work ran on 2026-10-15 and 2026-10-16, local time UTC−3.

## Format

Each zip holds:
- **`transcript.jsonl`:** the conversation as Claude Code records it, one JSON record per message, tool call and tool
  result, including compaction summaries.
- **A folder named after the session:** its title and the large tool results the transcript references, such as
  browser screenshots.
- **`metadata.json` and `local-session-state.json`:** the app's session metadata, including the instructions the app
  appends to the system prompt.

The raw export also holds a byte-identical second copy of the transcript, named after the session id. The copies here
keep only `transcript.jsonl`.

For a quick read, list the user and assistant turns with any JSONL viewer or `jq`, for example:

```bash
jq -r 'select(.type=="user" or .type=="assistant") | .message.content | if type=="string" then . else map(.text? // empty) | join("\n") end' transcript.jsonl
```

## Redactions

The raw exports are kept unchanged outside the repository (in `private/`, which is ignored). The files here are
copies in which only the material below was replaced inside JSON string values. Every other transcript line is
byte-for-byte identical to the raw export, and every JSON line still parses.

| Replaced material | Replacement |
|---|---|
| The author's email addresses (work, and the personal one shown in a `git config` output), including an escaped copy inside a check script, and the work email domain wherever it appears on its own | `[REDACTED: author email]`, `[email-domain]` |
| The company-specific part of the author's global Claude instructions (database, logging and internal-tool notes for unrelated work), which the environment injects into every session | `[REDACTED: the rest of the author's global Claude instructions …]` |
| Descriptions of four private skills from the author's environment (`card`, `commit`, `pr`, `wa-driver`) | `[REDACTED: private skill description]` |
| Tool names of one private MCP server unrelated to this project | `mcp__[private]__[redacted]` |
| An unrelated company name, and the titles of two unrelated sessions in a session listing | `[company]`, `[REDACTED: unrelated session]` |

- **Kept from the global instructions:** the general directive at their top (be efficient, work as the sole
  reasoning agent, reply in English). It shaped how these sessions were conducted.
- **No credentials were found, so none were redacted.**
  - The supplied OpenRouter key occurs in none of the exports. This was checked by matching its stored value without
    displaying it.
  - `gitleaks dir` over the extracted copies found no leaks.
  - A search for key- and token-like strings found none.
- **Not redacted:**
  - local file paths and the author's first name;
  - screenshots of the app;
  - environment-variable names and other private terms that appear only as search patterns in the check and
    redaction scripts written during packaging (names and patterns, no values). Those scripts are part of the main
    transcript.
- **The redaction script** read the raw exports, wrote these copies and reported per-file counts. It is not part of
  the application.
- **Checks on the copies:** every JSON line parses, and no residual email, domain, company, private-tool or
  unrelated-session string remains.

## Not included

- **Superseded export.** A partial export of the main session made on 2026-10-15 (up to the first report) is
  superseded by the full export and kept only privately.
- **Preparation work.** The product specification, design and research in `specs/` and `docs/research/` were prepared
  before this build, in a separate preparation workspace. Any AI sessions from that preparation are not among the
  sessions available here. If they are expected with the submission, the author must export them from where they ran.
