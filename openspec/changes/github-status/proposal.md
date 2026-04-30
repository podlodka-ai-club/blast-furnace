## Why

Orchestrator runs currently have no durable, user-visible progress indicator in GitHub, which makes it hard to understand which stage is active, what has completed, and whether Review has routed the work back for rework. We need a replaceable tracker integration boundary so GitHub comments are the first implementation rather than a hard-coded dependency throughout orchestration flow code.

## What Changes

- Add status reporting for orchestrator runs through a tracker client abstraction that can be implemented by GitHub now and another tracker service later.
- Create or update one GitHub status comment for a specific task/run, containing a checklist of the full orchestrator flow from task pickup through PR creation and issue transition to `in review`.
- Mark the task pickup step as completed in the initial status comment, because the comment is created when the task is accepted into work.
- Initialize durable run summary state before creating the initial external status comment, so status identity is persisted in run-scoped orchestration state from the first tracker side effect.
- Persist enough identity metadata to update the same status comment over time without confusing it with other tracker comments such as future plan or rework-start comments.
- Define deterministic status item states and stage-output mappings so updates are repeatable and terminal failures are distinguishable from retryable attempt failures.
- Use stable, attempt-aware checklist item ids and upsert status items by id so worker retries and Review rework expansion do not create duplicate rows.
- Model the default status sequence as progressing from task pickup through preparation, planning, development, Quality Gate, review, and a combined Draft PR / move issue to `in review` step.
- Extend the displayed status sequence dynamically when Review sends Develop back for rework, adding the rework Develop, Quality Gate, Review cycle and subsequent steps that follow from it.
- Update orchestration stages to report status changes as they start, complete, branch to rework, proceed to Make PR, or terminate.

## Capabilities

### New Capabilities

### Modified Capabilities
- `github-integration`: Add comment create/update support for configured-repository issue comments and define how the GitHub-backed tracker client identifies the correct status comment independently from other orchestrator comments using a strict hidden marker contract.
- `job-orchestration-infrastructure`: Add a flat tracker client abstraction, run-scoped status identity/state persistence, and shared helpers for full-flow status updates starting at task pickup.
- `develop-job`: Report Develop progress for initial work and Review-triggered rework attempts, including the handoff into Quality Gate status tracking.
- `review-job`: Report Review progress, successful transition to Make PR, Review-triggered rework expansion, and terminal Review failures.
- `make-pr-job`: Report combined Draft PR / move issue to `in review` progress and terminal no-change or pull-request outcomes, treating PR creation as sufficient for completing the visible status even if the issue transition fails afterward.

## Impact

- Affects orchestration flow units that own stage transitions and terminal outcomes.
- Extends GitHub integration with issue comment lookup/create/update behavior using configured owner/repo credentials.
- Adds a flat tracker client interface and at least one GitHub-backed implementation.
- Updates run summary or run-scoped orchestration state to persist status comment identity and the current expanded checklist model before the initial tracker status comment is created.
- Requires tests for status rendering, deterministic state mapping, comment identity selection, repeated updates to the same comment, idempotent checklist upserts, service abstraction boundaries, and Review rework sequence expansion.
