## Context

The Plan stage already renders its initial prompt from `prompts/plan.md`, validates the response, and stores the accepted plan in `PlanOutput.plan.content`. Develop currently builds its executor prompt inline in `src/jobs/develop.ts` and includes `JSON.stringify(data.plan, null, 2)` as "Plan context".

That inline JSON includes status and summary metadata that are useful for handoff bookkeeping but are not the implementation plan Codex should execute. The Develop stage also lacks a repository-owned prompt template, so changing wording requires TypeScript edits instead of prompt file edits.

Plan also has the newer Codex invocation behavior, including output-last-message support and session resume control. Develop should use the same helper path for Codex command construction and execution where the behavior overlaps, while explicitly starting a new Development session instead of resuming the Plan session.

## Goals / Non-Goals

**Goals:**

- Render the Develop executor prompt from `prompts/develop.md`.
- Include only validated `PlanOutput.plan.content` in the Develop prompt.
- Ensure Development launches a new Codex session, independent from the Plan session.
- Share Codex helper code between Plan and Develop, with the current Plan helpers as the source behavior to preserve.
- Keep Codex CLI argument construction, Stop-hook behavior, ledger handoff behavior, and queue flow unchanged.

**Non-Goals:**

- Changing Plan generation or validation behavior.
- Changing handoff ledger schemas or queue payload contracts.
- Introducing a general-purpose prompt templating dependency.
- Passing issue number, issue title, or issue description into the Develop prompt.

## Decisions

- Use a repository-owned Markdown template with explicit placeholders.
  - Rationale: matches the Plan stage pattern and keeps prompt text reviewable outside TypeScript.
  - Alternative considered: keep inline prompt construction and only swap JSON for `plan.content`; this would fix the immediate content issue but leave Develop prompt wording embedded in code.

- Render `PlanOutput.plan.content` directly into the Develop prompt.
  - Rationale: Plan validation establishes this content as the accepted implementation plan. The plan is expected to contain everything Development needs, so issue fields would be redundant prompt noise.
  - Alternative considered: include issue fields plus plan content; this duplicates context and weakens the Plan stage as the single execution brief.

- Use lightweight placeholder replacement matching the Plan prompt renderer.
  - Rationale: the current prompt templates need only simple scalar replacement, and adding a template dependency would be unnecessary.
  - Alternative considered: introduce a shared template engine; this is premature for two Markdown prompt files.

- Extract shared Codex helpers for Plan and Develop from the newer Plan implementation.
  - Rationale: Plan already owns the more current behavior for Codex command construction, output capture, and session resume control. Sharing that path reduces drift between stages.
  - Alternative considered: copy the Develop-specific pieces into Plan or duplicate Plan logic in Develop; this would keep two versions of command-building behavior that can diverge.

- Start Development as a new Codex session.
  - Rationale: Plan output crosses the stage boundary through the validated handoff ledger, not through live Codex session state. Development should execute the plan from a clean session for deterministic stage isolation.
  - Alternative considered: resume the Plan session for Development; this couples stages through hidden live context and makes the ledger less authoritative.

## Risks / Trade-offs

- Template drift or missing placeholders -> tests cover rendered prompt output.
- Plan content may contain text that resembles placeholders -> rendering should only replace placeholders in the template, not re-process inserted values.
- Missing `prompts/develop.md` at runtime -> Develop should fail clearly through the file read rather than silently falling back to stale inline prompt text.
- Shared Codex helper extraction can regress Plan invocation behavior -> preserve Plan tests and add focused coverage for both Plan resume behavior and Develop fresh-session behavior.
