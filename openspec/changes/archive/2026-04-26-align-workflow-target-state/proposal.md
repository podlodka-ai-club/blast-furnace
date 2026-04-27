## Why

The current queue-driven workflow still uses transitional stage names and payloads, with repository and workspace preparation owned by development-side jobs. The orchestrator needs to align its code and OpenSpec contract with the target workflow so every stage has a clear responsibility, durable run identity, and explicit queue handoff data.

## What Changes

- Rename worker routing and stage/job concepts to the target workflow: `Intake`, `Prepare Run`, `Assess`, `Plan`, `Develop`, `Quality Gate`, `Review`, `Make PR`, and `Sync Tracker State`.
- Keep `Intake` as the first pipeline stage responsible only for discovering eligible issues and enqueueing `Prepare Run`.
- Add missing workflow stages as isolated job types, allowing `Assess` and `Quality Gate` to start as stubs while still being represented as normal workflow stages.
- Restore and expand `Prepare Run` as the run bootstrap stage responsible for `runId`, initial `run.json`, run-level logging, branch name validation, branch creation or reuse, workspace preparation, repository clone, branch checkout/reset, and the base context artifact.
- Keep the existing `Plan` and `Review` stages in the target workflow; they can remain stub/passthrough stages in this iteration while carrying the updated queue payload shape.
- Narrow `Develop` to executor work: it uses the queue-provided run, issue, branch, workspace, and plan context needed to run Codex without owning branch or workspace preparation.
- Extend queue payloads with `runId`, `stage`, `stageAttempt`, and `reworkAttempt`, while keeping BullMQ retry attempts as internal queue mechanics rather than domain handoff state.
- Keep stage-to-stage handoff queue-based for this change; converting handoff to file/artifact references is explicitly deferred to a separate change.

## Capabilities

### New Capabilities

- `prepare-run-job`: Defines the run bootstrap job, repository preparation behavior, run metadata initialization, and base context artifact.
- `assess-job`: Defines the separate assessment stage and its stub-safe behavior within the queue-based pipeline.
- `develop-job`: Defines the executor-only development stage that consumes queue-provided prepared context and plan data and writes development output for downstream queue handoff.
- `quality-gate-job`: Defines the separate quality gate stage and its stub-safe behavior within the queue-based pipeline.
- `sync-tracker-state-job`: Defines the tracker synchronization stage that replaces the current `check-pr` terminal path after successful pull request creation.

### Modified Capabilities

- `issue-intake`: Intake should remain discovery-only and enqueue the first run stage instead of business-rich processing work.
- `github-issue-automation`: The product-level pipeline should reflect the target stage sequence and responsibility boundaries.
- `job-queue`: Worker routing and job payload requirements should use target workflow job types and include run identity plus stage/rework attempt counters.
- `job-orchestration-infrastructure`: Run-scoped infrastructure should support the target workflow's run initialization and stage attempt paths without moving handoff out of the queue in this change.
- `issue-processing`: Branch, clone, checkout, and workspace preparation requirements should move out of issue processing/development behavior and into `Prepare Run`.
- `plan-job`: Existing Plan should run after Assess, remain stub/passthrough if no substantive planning is implemented yet, consume queue-provided assessment context, produce plan data for queue handoff, and keep a place for future GitHub comment side effects.
- `review-job`: Existing Review should remain stub/passthrough if no substantive review is implemented yet, but be represented as a normal workflow stage with explicit queue input and output.
- `make-pr-job`: Make PR should consume queue handoff data from Review and schedule Sync Tracker State after a pull-request-created path.
- `check-pr-job`: Existing Check PR requirements should be retired or redirected because Sync Tracker State becomes the named terminal tracker stage.

## Impact

- Affected specs: `issue-intake`, `github-issue-automation`, `job-queue`, `job-orchestration-infrastructure`, `issue-processing`, `plan-job`, `review-job`, `make-pr-job`, `check-pr-job`, plus new specs for `prepare-run-job`, `assess-job`, `develop-job`, `quality-gate-job`, and `sync-tracker-state-job`.
- Affected code: `src/types/index.ts`, worker routing in `src/jobs/worker.ts`, queue payload helpers and job data types, existing job flow/work modules, new job modules for the target stages, run metadata/context helpers, repository workspace preparation utilities, and related tests.
- Affected documentation: OpenSpec artifacts and any project docs that describe stage names, queue payload shape, or job responsibilities.
