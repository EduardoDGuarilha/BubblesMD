# Suggestion API contract

Status: specified boundary, no running endpoint. Use when connecting the early real AI writing flow. Implement typed C# DTOs and validate this contract; no generated API or server is claimed to exist.

`POST /api/suggest` accepts a typed, bounded request with request/review IDs, captured revision, action (initial/refine/refresh), Fast/Smart mode, selected source Markdown, separately bounded before/after context, active reflection records, and optional prior candidate/keep-original choices. The server resolves an allowlisted model; the client never supplies provider credentials or an arbitrary endpoint.

The model returns only one outcome: `replace` with replacement Markdown; `unchanged` with a short reason; or `cannot_apply` with a short reason. An empty replacement is valid for a requested deletion of the entire selection; show that intent visibly and allow explicit acceptance. It is not a no-op or malformed response. The server wraps validated output with captured identifiers, returned model, and nullable usage/cost metadata; model output cannot authorize scope or acceptance.

Validate request size, output shape, finish status, and Markdown safety. Concrete starting bounds: 1 MiB imported file, 16,000 selected characters, 4,000 surrounding characters total, 8,000 active-reflection characters total, and a bounded HTTP body. Expose useful limit errors; do not silently truncate the selected scope or thoughts. Configure an output limit sufficient for the supported selection and document it. A truncated/invalid response is a failure, not an acceptable partial replacement. Keep input/output/reasoning parameters compatible with the selected provider route.

Separate source prose/context from writing instructions; embedded instructions inside a document are content, not authority. Default to drafting a reasonable requested improvement; do not invent missing facts or build a mandatory clarification chatbot. The model cannot certify facts. Ordinary software computes diffs, checks revisions, and applies changes.

Set a finite provider timeout and propagate cancellation where supported. Handle invalid input, rate/budget errors, unavailable provider, malformed output, network failure, and timeout without losing writing or thoughts. No automatic fallback to a more expensive model. Late/duplicate responses cannot overwrite current source or revive discarded reviews. Still record returned usage for a discarded/outdated request if available. Provider cancellation does not prove zero charge.

## Implementation verification

Use focused checks for request/output validation and relevant provider failures; exercise the real request path early. Use local fixtures for deterministic failures and a few paid calls for provider compatibility/writing quality. Add cases for concrete risks or observed failures rather than one test per possible response. The request/output contract above remains unchanged.
