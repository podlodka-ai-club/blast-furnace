## Why

The pipeline still uses BullMQ payloads as the practical handoff between stages, which makes run state hard to audit, validate, and replay deterministically. This change moves inter-stage handoff into run-scoped files with explicit output contracts so every pipeline transition has a durable, schema-checked record.

## What Changes

- Introduce one append-only handoff JSONL ledger per run as the single durable carrier of all stage output and handoff data, with no duplicate per-stage artifact JSON files.
- Store each run in a timestamp-prefixed run directory named `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/` under the Blast Furnace repository root, not inside the cloned target repository workspace.
- Name the mutable run summary file with the same timestamp and `runId`, for example `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/YYYY-MM-DD_HH.MM_runId_run.json`.
- Store the run's JSONL handoff ledger in the same directory and name it with the same timestamp and `runId`, for example `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/YYYY-MM-DD_HH.MM_runId_handoff.jsonl`.
- Do not create a `run.log` file or any replacement runtime logging file as part of run artifact initialization.
- Keep the target repository workspace clean of `.orchestrator/**`; pull requests against the target repository must include only task changes.
- Define each JSONL line as the validated JSON object for one pipeline transition and its producing stage output, including the source stage, target stage, attempts, dependency pointer to the previous stage/record, and the complete output data needed by the next stage.
- Define formal output contracts and validation for `Prepare Run`, `Assess`, `Plan`, `Develop`, `Quality Gate`, `Review`, `Make PR`, and `Sync Tracker State`, including success, failure, blocked, clarify, and rework-needed shapes where applicable.
- Update the timestamped `run.json` to remain the mutable run status summary while pointing to the active handoff ledger, current stage, stage attempt statuses, `stageAttempt` and `reworkAttempt` counters, and current JSONL record pointers.
- Reduce stage queue payloads to transport metadata: `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and input handoff record references.
- Validate stage outputs and handoff records before enqueueing the next stage, failing deterministically when a contract is invalid.
- **BREAKING** for internal job contracts: downstream stages stop receiving issue, repository, branch, workspace, plan, development, quality, review, and pull request state as primary queue payload fields.

## Capabilities

### New Capabilities

- `run-handoff-ledger`: Defines the per-run JSONL handoff ledger, handoff record shape, timestamp-prefixed run directory and file naming, dependency fields, record references, complete embedded stage outputs, and schema validation rules for stage-to-stage transfer.

### Modified Capabilities

- `job-orchestration-infrastructure`: Replace deferred output contracts with concrete run handoff ledger files, schema validation, immutable JSONL appends, timestamp-prefixed run directory naming, and `run.json` pointers.
- `job-queue`: Change workflow stage payload requirements from transitional business-data transport to minimal transport metadata plus handoff record references.
- `github-issue-automation`: Update product-level pipeline behavior so stages pass durable handoff record references instead of business state through queue payloads.
- `prepare-run-job`: Require Prepare Run to initialize the timestamped run directory and run status, then append the first validated stage output and handoff record for Assess to the JSONL ledger.
- `assess-job`: Require Assess to read its input from the JSONL ledger, append a formal assessment output record, and hand off to Plan through the JSONL ledger.
- `plan-job`: Require Plan to read assessed input from the JSONL ledger, append a formal plan output record, and hand off to Develop through the JSONL ledger.
- `develop-job`: Require Develop to read issue, workspace, and plan context from the JSONL ledger, append a formal development output record, and hand off to Quality Gate through the JSONL ledger.
- `quality-gate-job`: Require Quality Gate to read development context from the JSONL ledger, append a formal quality output record, and hand off to Review through the JSONL ledger.
- `review-job`: Require Review to read quality context from the JSONL ledger, append a formal review output record, and hand off to Make PR through the JSONL ledger.
- `make-pr-job`: Require Make PR to read reviewed development context from the JSONL ledger, append a formal pull request or no-change output record, and hand off to Sync Tracker State only when tracker synchronization is needed.
- `sync-tracker-state-job`: Require Sync Tracker State to read pull request context from the JSONL ledger, append a formal tracker-sync output record, and mark the run complete in `run.json`.

## Impact

- Affected code: `src/jobs/*`, `src/types/index.ts`, shared run-file utilities, queue payload creation and validation, and tests for each stage handler.
- Affected runtime files in the Blast Furnace repository: `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/YYYY-MM-DD_HH.MM_runId_run.json` and `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/YYYY-MM-DD_HH.MM_runId_handoff.jsonl`.
- Affected schemas: new or updated validation schemas for embedded stage outputs, handoff records, queue payloads, and run summary pointers.
- Operational impact: runs become easier to inspect chronologically by handoff filename and easier to debug by reading the single JSONL handoff ledger for a run.
