## Context

The current pipeline is queue-driven and already has separate `plan` and `review` jobs, but those stages are pass-through modules: Plan forwards issue and branch data to `codex-provider`, and Review forwards issue, branch, and repository path data to `make-pr`. Repository preparation is split across the current `issue-processor` and `codex-provider`: issue processing creates or verifies the branch, while Codex execution creates the temporary workspace, clones the repository, and checks out the branch.

This change aligns the implementation with the target workflow from `docs/orchestrator-target-state-plan.md` section 2: `Intake -> Prepare Run -> Assess -> Plan -> Develop -> Quality Gate -> Review -> Make PR -> Sync Tracker State`. The important boundary for this change is that stage handoff remains queue-based. File/artifact-reference handoff is a later change; this change may write run metadata or context records for observability and future compatibility, but downstream stages continue to receive the data they need through BullMQ payloads.

## Goals / Non-Goals

**Goals:**

- Use target workflow stage names consistently in worker routing, job data types, OpenSpec, logs, and tests.
- Keep `Intake` as the first stage and restrict it to finding eligible issues and enqueueing `Prepare Run`.
- Move run bootstrap, branch preparation, workspace creation, repository clone, and branch checkout/reset into `Prepare Run`.
- Add `Assess` and `Quality Gate` as explicit stub-safe job stages.
- Keep existing `Plan` and `Review` stages, while making it explicit that they may remain pass-through/stub stages in this iteration.
- Narrow `Develop` to Codex executor behavior using queue-provided run, issue, branch, workspace, and plan context.
- Extend stage queue payloads with `runId`, `stage`, `stageAttempt`, and `reworkAttempt`.

**Non-Goals:**

- Do not convert stage handoff to file paths, artifact references, or schema-validated files.
- Do not implement substantive assessment, planning, quality gate, or review logic beyond stub/pass-through behavior.
- Do not introduce the rework loop beyond carrying `reworkAttempt` through payloads.
- Do not change BullMQ retry semantics or treat BullMQ retry count as domain stage attempt state.

## Decisions

### Use target stage slugs as routed job names

Worker routing should use kebab-case job names that correspond directly to the target stages:

- `intake`
- `prepare-run`
- `assess`
- `plan`
- `develop`
- `quality-gate`
- `review`
- `make-pr`
- `sync-tracker-state`

The existing modules can be migrated incrementally by renaming or wrapping current handlers: `issue-watcher` becomes the Intake implementation, `issue-processor` becomes Prepare Run responsibility, `codex-provider` becomes Develop responsibility, and `check-pr` becomes Sync Tracker State. Plan, Review, and Make PR keep their domain names.

Alternative considered: keep current job names and add a separate display-name mapping. That would reduce code churn, but it keeps two vocabularies in routing, tests, logs, and specs. The target-state work is specifically about removing that mismatch.

### Keep handoff in queue payloads for this change

Each stage should enqueue the next stage with a JSON-compatible queue payload. The payload carries the current transitional business data such as issue, repository identity, branch name, workspace path, plan data, development result, quality result, review result, and pull request result as needed by the next stage.

Run metadata and context files may be written under `.orchestrator/runs/<runId>/` when useful, but they are not the handoff contract in this change. The runtime source of truth for stage inputs remains the BullMQ job payload.

Alternative considered: switch immediately to artifact-reference payloads. That is deliberately deferred because section 3 of the target-state plan covers file handoff, output contracts, and schema validation as a separate piece of work.

### Introduce a shared stage payload envelope

Add a shared payload shape for pipeline stage jobs:

```ts
type WorkflowStage =
  | 'intake'
  | 'prepare-run'
  | 'assess'
  | 'plan'
  | 'develop'
  | 'quality-gate'
  | 'review'
  | 'make-pr'
  | 'sync-tracker-state';

interface StageJobPayload extends JobPayload {
  runId: string;
  stage: WorkflowStage;
  stageAttempt: number;
  reworkAttempt: number;
}
```

Stage-specific job data should extend this envelope with transitional queue fields. `stageAttempt` starts at `1` for a stage and is reserved for domain-level stage reruns or later artifact path selection. `reworkAttempt` starts at `0` and is reserved for the future business rework cycle. BullMQ retry attempts remain internal queue mechanics and must not be read as `stageAttempt`.

`Prepare Run` is responsible for run identity. To keep `Intake` discovery-only while still enqueueing a payload that contains `runId`, Intake should call a Prepare Run payload factory owned by the Prepare Run module. The factory allocates `runId`, sets `stage: 'prepare-run'`, initializes `stageAttempt: 1` and `reworkAttempt: 0`, and returns `PrepareRunJobData`.

Alternative considered: let Intake own `runId` generation directly. Keeping the factory in the Prepare Run module keeps run bootstrap responsibility localized while still satisfying the queue payload contract.

### Move repository preparation into Prepare Run

Prepare Run should perform all deterministic run and repository setup before scheduling Assess:

- create or initialize the run directory and `run.json`;
- create the run-level log file path or log target;
- build and validate `branchName`;
- create or reuse the issue branch;
- create the local workspace;
- clone the repository;
- fetch, checkout, and reset the branch;
- write any base run context record needed for observability or future file-based handoff;
- enqueue Assess with queue data containing `runId`, attempts, issue, repository identity, branch name, and workspace path.

If Prepare Run fails before successful handoff, it should clean up any workspace it created and avoid leaving an orphaned issue branch when branch creation happened in this run. Once Assess has been enqueued, downstream terminal stages remain responsible for workspace cleanup according to the queue path outcome.

Alternative considered: leave clone and checkout in Develop. That keeps the current behavior, but it prevents Assess and Plan from running against a real prepared repository, which is the main responsibility shift in this change.

### Keep Plan and Review as explicit stub/pass-through stages

Plan and Review already exist, but their current behavior is only queue forwarding. That remains acceptable for this iteration:

- Assess may produce a minimal stub assessment result and enqueue Plan.
- Plan may log that planning is stubbed, pass through the queue context needed by Develop, and reserve a place in its result payload for future plan details or GitHub comment side effects.
- Quality Gate may produce a minimal stub quality result and enqueue Review.
- Review may log that review is stubbed, pass through the queue context needed by Make PR, and reserve a place in its result payload for future review findings.

The important change is structural: these stages sit in the target order, use the target payload envelope, and have explicit typed input/output instead of implicit passthrough behavior.

### Narrow Develop to executor-only work

Develop should replace the current Codex provider stage name and consume the workspace prepared by Prepare Run. It should no longer create the temp directory, clone the repository, or fetch/checkout/reset the issue branch. Its work is to build and run the Codex command in the prepared workspace, stream logs, enforce timeout, and enqueue Quality Gate with queue payload data describing the development result and the existing workspace path.

Make PR keeps deterministic finalization ownership: detect changes, commit, push, create pull request, and handle the no-change terminal path. Sync Tracker State replaces Check PR for the post-PR tracker side effects and terminal cleanup for the pull-request-created path.

## Risks / Trade-offs

- Naming migration can break worker routing or queued jobs during development -> Update routing, job data types, tests, and docs together; avoid running mixed old/new workers against the same Redis queue during local migration.
- Moving workspace setup earlier increases the lifetime of temporary workspaces -> Preserve the existing cleanup discipline and add failure-path tests for Prepare Run, Make PR no-change, and Sync Tracker State terminal cleanup.
- Queue payloads remain business-rich for now -> Keep the shared envelope small and make transitional service fields explicit so the later file-handoff change has a clear boundary to remove them.
- `stageAttempt` can be confused with BullMQ retries -> Encode this distinction in types, helper names, tests, and documentation; do not derive domain attempts from BullMQ job attempts.
- Stub stages add queue hops without adding substantive decisions yet -> Accept the short-term latency cost because the target workflow needs stable stage boundaries before later assessment, planning, quality, and review logic can be added safely.

## Migration Plan

1. Add target workflow stage types, shared stage payload envelope, and helpers for creating next-stage queue payloads.
2. Update worker routing to target job names and add handlers for `prepare-run`, `assess`, `develop`, `quality-gate`, and `sync-tracker-state`.
3. Migrate Intake so polling discovery enqueues `prepare-run` payloads through the Prepare Run payload factory.
4. Move branch creation/reuse, workspace creation, clone, fetch, checkout, and reset behavior from issue processing and Codex provider code into Prepare Run.
5. Update Plan and Review to keep pass-through/stub behavior while consuming and emitting the new queue payload envelope.
6. Update Develop to run Codex only inside the prepared workspace and enqueue Quality Gate.
7. Update Make PR to schedule `sync-tracker-state` after pull request creation and preserve no-change terminal behavior.
8. Replace Check PR routing/spec references with Sync Tracker State behavior.
9. Update tests and docs so current behavior is preserved except for the intended stage names, routing, payload envelope, and responsibility boundaries.
