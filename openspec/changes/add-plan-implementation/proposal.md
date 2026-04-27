## Why

Plan is currently a stub, so Develop receives only placeholder planning context even though the pipeline already has assessed issue data and durable handoff records. Implementing Plan now gives the workflow a real planning checkpoint with deterministic validation before Codex begins repository changes.

## What Changes

- Replace the stub Plan output with Codex-backed plan generation.
- Build the initial Plan prompt by rendering a hardcoded prompt template file with placeholders for the assessed issue title and description.
- Run Codex for planning and wait for completion before appending the Plan handoff record.
- Keep all Plan revision attempts inside the same Plan Codex session so revision context is preserved, and persist only accepted Plan handoff data when validation succeeds.
- Save every Codex planning attempt in the JSONL handoff ledger, whether deterministic verification succeeds or fails.
- Add YAML-configured deterministic plan checks for required response section titles.
- Retry planning in the same Plan Codex session with a hardcoded continuation prompt when validation fails, up to three total Codex attempts.
- For failed verification attempts before the retry limit, append a non-terminal Plan handoff record and continue planning with the hardcoded continuation prompt.
- Only the third consecutive failed verification attempt is terminal; record that terminal unsuccessful plan in handoff using existing non-urgent handoff fields rather than enqueueing Develop.
- When validation succeeds, enqueue Develop with the successful Plan handoff record reference.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plan-job`: Change Plan from stubbed output to Codex-backed plan generation with prompt-template input, YAML-driven deterministic validation, per-attempt handoff recording, bounded continuation retries, terminal failure recording, and successful handoff to Develop.

## Impact

- Affected code: `src/jobs/plan.ts`, Plan tests, shared handoff output schemas/types for Plan output shape, and any Plan-specific helper modules introduced for prompt loading, Codex execution, or validation.
- Affected configuration/files: a hardcoded Plan prompt template path and a YAML file containing required plan response titles.
- Affected systems: Codex CLI invocation during Plan, JSONL handoff ledger records, and Plan-to-Develop queue handoff references.
- No breaking API changes are expected for external HTTP routes or queue payload transport; downstream stages continue to receive transport-only payloads with handoff record references.
