## Context

The current Plan job validates a transport-only input payload, reads the assessed handoff record, appends a stub `plan` object, and enqueues Develop with a new handoff record reference. Develop then reads that Plan output from the JSONL ledger and uses it as prompt context for Codex implementation work.

This change keeps the existing stage boundary model but replaces the stub with a substantive Plan stage. Plan must render one repository-owned prompt template with issue title/body placeholders, invoke Codex in its own fresh process/session, validate the response with deterministic checks, record every planning attempt in the ledger, retry within that same Plan Codex session with a continuation prompt when needed, and mark only the third consecutive failed verification attempt as terminal.

## Goals / Non-Goals

**Goals:**

- Generate Plan output by invoking the configured Codex CLI during the Plan job.
- Keep queue payloads transport-only; Plan and Develop continue to exchange data through JSONL handoff records.
- Store the accepted plan text in `PlanOutput.plan`.
- Store each unsuccessful plan attempt in a non-terminal Plan handoff record until the retry limit is reached.
- Store the third consecutive unsuccessful plan attempt as a non-urgent terminal Plan handoff record and stop the workflow without enqueueing Develop.
- Make deterministic plan checks easy to change by loading required response titles from a YAML file.
- Preserve Plan revision context by keeping all Plan attempts in one Codex session.
- Reuse the existing Codex configuration conventions where practical.

**Non-Goals:**

- Implement semantic plan quality checks beyond required-title validation.
- Add GitHub planning comments.
- Change Develop execution semantics or the target repository preparation flow.
- Add multi-agent planning or alternative AI providers.
- Restart the Codex session between Plan revision attempts.
- Change Develop implementation or validation semantics; any Develop-owned contract changes should be handled by a separate change.
- Make prompt/check file paths runtime-configurable in this first iteration.

## Decisions

1. Keep Plan as the only owner of planning orchestration.

   Plan-specific prompt construction, Codex execution, validation, retry decisions, and terminal failure handling should live behind the Plan module or Plan-owned helpers. Worker routing and downstream stages should continue to call `runPlanFlow` / `runPlanWork` without knowing the details.

   Alternative considered: move Codex execution into Develop and make Plan only prepare prompt metadata. That would keep Plan simpler, but it would not create a real planning checkpoint before implementation starts.

2. Use a hardcoded prompt template path and validation file path.

   Add a prompt template file such as `prompts/plan.md` and a validation file such as `config/plan-checks.yaml`, referenced by constants in the Plan implementation. The prompt file is a complete high-quality prompt template, not a preamble that Plan appends task text to afterward. It must contain explicit placeholders for task data, for example `{{issueTitle}}` and `{{issueDescription}}`, and Plan renders those placeholders before invoking Codex.

   The rendered prompt should include the issue number/title and issue body with an explicit empty-description fallback so Codex receives one coherent prompt.

   Alternative considered: add environment variables immediately. The user asked for hardcoded paths, and keeping configuration out of the first iteration reduces the number of runtime failure modes.

3. Add a small Codex execution helper that can capture output.

   Develop already contains Codex CLI argument construction and PTY-based process handling. Plan needs similar invocation behavior, but unlike Develop it must capture the generated response. Extract or introduce a shared helper for command splitting, Codex default args, timeout handling, and stream capture, while keeping Develop-only Stop-hook behavior in Develop.

   Inside the Plan stage, all revision attempts for one Plan job run occur in the same Codex process/session so Codex keeps the prior planning context. Attempts 2 and 3 send continuation prompts into that existing session rather than starting a new one. Plan does not pass live Codex session state across the stage boundary; it records accepted plan content in the JSONL handoff ledger and enqueues Develop with the resulting handoff record reference.

   Alternative considered: duplicate the process-spawn code in Plan. That is faster initially but risks diverging Codex CLI behavior, model selection, timeout handling, and logging between stages.

4. Represent Plan result state explicitly in the handoff output.

   Extend `PlanResult` from the current stub-only shape to support only the data Develop or operators need:

   - `status: 'success' | 'validation-failed'`
   - `summary`
   - `content`
   - `failureReason` for terminal failures

   Successful Plan records write the accepted plan into `PlanResult.content`, use handoff `status: 'success'`, set `toStage: 'develop'`, and enqueue Develop. Failed verification records write the unsuccessful plan into `PlanResult.content`, set `PlanResult.status` to `validation-failed`, and include a human-readable `failureReason`.

   Failed verification attempts before the retry limit are non-terminal handoff records. They should use existing handoff fields to show that Plan is continuing, for example `status: 'rework-needed'` with `toStage: 'plan'`, and the next Codex attempt depends on the previous failed-attempt handoff record. The third consecutive failed verification attempt is terminal: use handoff `status: 'blocked'`, set `toStage: null`, and do not enqueue Develop. This records failed verification transparently and non-urgently without treating it as an urgent runtime failure.

   The internal Codex retry count is not persisted in `PlanResult`; attempt order is visible from the chained handoff records, and `stageAttempt` remains the pipeline-level Plan stage attempt counter.

   Alternative considered: keep failed verification attempts in memory and append only the final result. That is simpler, but it hides the intermediate Codex outputs and failed checks that operators need for transparency. Throwing an error or appending handoff `status: 'failure'` for deterministic verification misses was also rejected because it would overstate the condition as an urgent runtime failure.

5. Validate required titles from YAML.

   The YAML file should define a narrow schema, for example:

   ```yaml
   requiredTitles:
     - Summary
     - Implementation Plan
     - Risks
   ```

   Plan loads and validates this file before running checks. A title passes when the generated response contains a Markdown heading matching the required title case-insensitively after trimming heading markers and whitespace. Use a real YAML parser dependency rather than ad hoc string splitting so later check additions do not require replacing the loader.

   Alternative considered: JSON config. YAML better matches the requested operator-editable format.

6. Retry with accumulated context, capped at three attempts.

   Attempt 1 uses the initial prompt to start the Plan Codex session. Attempts 2 and 3 send a hardcoded continuation instruction into the same session, preserving Codex context from earlier planning attempts. After each attempt, Plan appends a handoff record containing that attempt's response and verification outcome. If attempt 1 or 2 fails verification, Plan appends a non-terminal failed-attempt record and continues in the same Codex session. If attempt 3 fails verification, Plan appends a terminal blocked record and stops without enqueueing Develop.

   Alternative considered: append only one handoff record after all retries finish. That would keep the ledger shorter, but it would hide intermediate failed plans and make Plan behavior harder to audit.

## Risks / Trade-offs

- Codex output capture may include terminal control text or progress logs -> capture and normalize text before validation, and tests should use an injected executor to avoid depending on real Codex output.
- Keeping Plan retries in one Codex session requires interactive session control -> wrap Codex execution behind a Plan executor interface so tests can assert prompt sequence and captured responses without a real Codex process.
- YAML parsing introduces a runtime dependency -> keep the schema small, validate loaded values strictly, and fail Plan before invoking Codex when the checks file is invalid.
- Required-title checks can pass low-quality plans -> this is accepted for the first iteration and leaves semantic checks for later.
- Per-attempt handoff records require careful chaining -> each Plan attempt record should depend on the previous Plan input or attempt record so the ledger shows the full retry trail.
- Terminal blocked handoff records require schema updates -> update `PlanOutput` and handoff contract tests together so failed Plan output is valid and non-urgent.
- Retrying inside one BullMQ job can increase Plan runtime -> use the existing Codex timeout per process invocation and keep the maximum attempt count fixed at three.

## Migration Plan

1. Add failing tests for prompt template rendering, YAML check loading, required-title validation, per-attempt handoff recording, retry behavior, non-urgent terminal blocked handoff after the third failed verification, and successful Develop enqueueing with accepted plan content.
2. Introduce the Plan prompt file and YAML check file.
3. Add or extract Codex execution helpers that allow Plan tests to inject fake executor results.
4. Extend `PlanResult`, `PlanOutput`, and runtime output schemas to represent successful and terminal validation-failed Plan records.
5. Replace the stub Plan implementation with Codex-backed prompt, validation, retry, and handoff flow.
6. Run focused Plan, handoff-contract, and type tests, then run the broader test suite.

Rollback is straightforward before release: restore the stub Plan implementation and schema shape, remove the new prompt/check files, and keep transport-only queue payloads unchanged.

## Open Questions

- What exact default required titles should ship in `plan-checks.yaml`?
- Should the continuation prompt ask Codex to rewrite the full plan every time, or only append missing sections? The first implementation should prefer a full rewritten plan so the accepted Plan output is coherent.
