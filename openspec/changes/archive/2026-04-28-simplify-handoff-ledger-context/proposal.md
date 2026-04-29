## Why

The handoff JSONL records currently duplicate context by carrying cumulative stage outputs and a `nextInput` object that mostly repeats transition metadata already present on the record. This makes the durable handoff contract harder to inspect, harder to validate, and likely to grow stale as stage-specific input needs diverge.

## What Changes

- **BREAKING** Remove `nextInput` from handoff JSONL records; queue payloads remain transport-only and are created from the appended record reference at scheduling time.
- **BREAKING** Make each handoff record `output` contain only the formal output produced by `fromStage`, instead of accumulating prior stage outputs.
- **BREAKING** Treat stable run context as run state in `run.json`, including issue identity, configured repository identity, prepared branch name, and workspace path.
- **BREAKING** Replace the single linear handoff dependency model with explicit stage input context dependencies so each stage can declare and read only the prior records it needs.
- Add shared context resolution behavior that combines immutable stage-local handoff outputs with stable run context from `run.json`.
- Update stage contracts so downstream jobs read required inputs from the explicit dependency graph rather than assuming the latest handoff output contains a full context snapshot.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-handoff-ledger`: Change the handoff record shape, remove `nextInput`, require stage-local outputs, and support explicit dependency record ids for stage input context.
- `job-orchestration-infrastructure`: Store stable run context in the mutable run summary and provide shared context resolution from `run.json` plus selected handoff records.
- `github-issue-automation`: Update pipeline-level behavior so stages consume stable run context and explicit handoff dependencies instead of cumulative JSONL snapshots.
- `prepare-run-job`: Record prepared issue, repository, branch, and workspace context as stable run context while appending only Prepare Run's stage-local handoff output.
- `assess-job`: Append only assessment output and read stable run context from `run.json`.
- `plan-job`: Append only plan attempt output and read only the assessment output plus stable run context required for planning.
- `develop-job`: Read accepted plan output plus stable run context, and append only development and quality output.
- `review-job`: Read plan output, development output, and quality output explicitly, and append only review output.
- `make-pr-job`: Read review output and any required development/quality context explicitly, use stable run context for repository finalization, and append only Make PR output.
- `sync-tracker-state-job`: Read pull request output plus stable run context, and append only tracker synchronization output.

## Impact

- Affected runtime files: `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/<YYYY-MM-DD_HH.MM_runId>_run.json` and `_handoff.jsonl`.
- Affected TypeScript contracts and validation: `HandoffRecord`, run summary data, stage output schemas, handoff record validation, and stage input context readers.
- Affected job modules: Prepare Run, Assess, Plan, Develop, Review, Make PR, and Sync Tracker State.
- Operational impact: existing in-flight jobs and existing handoff JSONL records using cumulative outputs and `nextInput` will not match the new contract without a compatibility reader or a controlled drain.
