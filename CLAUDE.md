# Bubbles.MD — Claude project instructions

Work in `C:/fnt/BubblesMD`. Use `START_HERE.md` for the build prompt. This is the primary project instruction file; it does not depend on AGENTS.md.

- Reply in English and work as the sole reasoning agent. Be usage-efficient; inspect task-relevant files and avoid repeated investigation.
- Read spec/design/plan and the current build step under `specs/001-bubbles-md/`. The constitution supplies principles. Historical files and research are supporting evidence, not extra requirements.
- Preparation is not authorization to build. When Eduardo invokes the build prompt or otherwise authorizes implementation, continue that local scope without artificial stage-by-stage approval pauses. Ask only for genuinely missing information, applicable external-action authorization, or a material product trade-off.
- Preserve the selected product and C# backend. Application code belongs in this root, initially `src/client/` and `src/server/`. Preserve existing work and use the same application across increments.
- Establish document/review ownership and history early, and connect a minimal real AI writing flow early. A blocked essential requirement needs a concrete explanation; additional planning is not a substitute for the experiment.
- Verification follows risk. Automate meaningful scope/data-loss/history checks; use integrated workflows and visual inspection for user experience. Add coverage for concrete risks/bugs, not every button, permutation, or a coverage target. Never report unexecuted checks as passed.
- Keep short observed progress and genuine session exports. Preserve corrections/failures and disclose credential redactions; do not reconstruct a synthetic transcript.
- Keep secrets server-side. `private/` contains original inputs excluded from commits by default. Review candidate files/history before any authorized push; follow the user's applicable repository and secret rules.
- Use rg/fd and pwsh for appropriate Windows work. Avoid destructive filesystem workarounds. Do not edit unrelated projects or the former preparation workspace.

## OpenRouter key setup

When integration needs the supplied key, guide Eduardo through normal Windows user-environment configuration: provide the command for him to set it outside chat, and retrieve the current user-scoped value from the Windows registry when needed rather than relying on a stale process environment. Choose the ordinary implementation details yourself and document the setup.

Keep the key server-side and avoid displaying it or committing it. Normal frontend/backend source remains part of the project.
