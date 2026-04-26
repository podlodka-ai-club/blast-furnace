## 1. Queue Payload and Workflow Types

- [x] 1.1 Add failing type tests for the target workflow stage names: `intake`, `prepare-run`, `assess`, `plan`, `develop`, `quality-gate`, `review`, `make-pr`, and `sync-tracker-state`
- [x] 1.2 Add failing type tests that every workflow stage payload includes `runId`, `stage`, `stageAttempt`, and `reworkAttempt`
- [x] 1.3 Update shared job payload types to introduce the target workflow stage union and stage payload envelope
- [x] 1.4 Update stage-specific job data types for Intake, Prepare Run, Assess, Plan, Develop, Quality Gate, Review, Make PR, and Sync Tracker State
- [x] 1.5 Add or update payload factory helpers so normal forward transitions preserve `runId` and `reworkAttempt` while setting the next `stage` and `stageAttempt`
- [x] 1.6 Add tests that BullMQ retry metadata is not used as domain `stageAttempt`

## 2. Worker Routing and Intake

- [x] 2.1 Add failing worker routing tests for every target job type and for unknown job type failure
- [x] 2.2 Update worker routing to call handlers for `intake`, `prepare-run`, `assess`, `plan`, `develop`, `quality-gate`, `review`, `make-pr`, and `sync-tracker-state`
- [x] 2.3 Add failing intake tests showing polling discovery enqueues `prepare-run` jobs instead of `issue-processor` jobs
- [x] 2.4 Rename or wrap the current issue watcher implementation as the `intake` stage while preserving polling behavior, repository fallback, repository registry handling, and last-poll timestamp behavior
- [x] 2.5 Update application startup to schedule the repeatable `intake` job with repeatable id `intake-repeatable`
- [x] 2.6 Update intake logging and tests to use target stage naming without adding implementation work to Intake

## 3. Prepare Run

- [x] 3.1 Add failing Prepare Run tests for run payload creation with generated `runId`, `stage: prepare-run`, `stageAttempt: 1`, and `reworkAttempt: 0`
- [x] 3.2 Add failing Prepare Run tests for initial `run.json` creation and run-level log target setup
- [x] 3.3 Add failing Prepare Run tests for branch slugging, branch name validation, branch creation when absent, and branch reuse when present
- [x] 3.4 Add failing Prepare Run tests for local workspace creation, repository clone, branch fetch, checkout, and reset
- [x] 3.5 Add failing Prepare Run tests that successful preparation enqueues `assess` with run, issue, repository, branch, workspace, and attempt data in the queue payload
- [x] 3.6 Add failing Prepare Run cleanup tests for workspace cleanup and branch cleanup when preparation fails before Assess handoff
- [x] 3.7 Implement the `prepare-run` module by moving branch preparation and repository workspace preparation out of the current issue processor and Codex provider responsibilities
- [x] 3.8 Remove or retire the old `issue-processor` routing path after Prepare Run owns its responsibilities

## 4. Assess, Plan, Quality Gate, and Review

- [x] 4.1 Add failing Assess tests for receiving prepared run data, producing stub assessment data, and enqueueing `plan`
- [x] 4.2 Implement the `assess` module as an isolated stub-safe stage with explicit typed queue input and output
- [x] 4.3 Add failing Plan tests for receiving assessment data, preserving queue context, producing stub plan data, and enqueueing `develop`
- [x] 4.4 Update the existing Plan module to remain stub/pass-through while using the target queue payload envelope and reserving future GitHub comment side-effect data
- [x] 4.5 Add failing Quality Gate tests for receiving development data, producing a stub passing quality result, and enqueueing `review`
- [x] 4.6 Implement the `quality-gate` module as an isolated stub-safe stage with explicit typed queue input and output
- [x] 4.7 Add failing Review tests for receiving quality data, preserving queue context, producing stub review data, and enqueueing `make-pr`
- [x] 4.8 Update the existing Review module to remain stub/pass-through while using the target queue payload envelope

## 5. Develop

- [x] 5.1 Add failing Develop tests proving it uses the Prepare Run workspace and does not create a workspace, clone the repository, fetch the branch, check out the branch, or reset the branch
- [x] 5.2 Add failing Develop tests for Codex command construction, prompt content with issue and plan context, PTY execution, output logging, and timeout behavior
- [x] 5.3 Add failing Develop tests that successful executor completion enqueues `quality-gate` with run, issue, repository, branch, workspace, plan, development result, and attempt data
- [x] 5.4 Add failing Develop tests for non-zero Codex exit and timeout failure paths
- [x] 5.5 Rename or wrap the current Codex provider implementation as the `develop` stage and remove repository preparation from development work
- [x] 5.6 Preserve existing Codex execution behavior while ensuring Develop does not commit, push, create pull requests, transition tracker state, or perform terminal cleanup

## 6. Make PR and Sync Tracker State

- [x] 6.1 Add failing Make PR tests for receiving reviewed target-stage queue data and preserving run, issue, repository, branch, workspace, development, quality, review, and attempt data as needed
- [x] 6.2 Update Make PR tests and implementation so no-change outcomes remain terminal inside Make PR and clean up the workspace without enqueueing `sync-tracker-state`
- [x] 6.3 Update Make PR tests and implementation so pull-request-created paths enqueue `sync-tracker-state` instead of `check-pr`
- [x] 6.4 Move post-PR tracker label transition out of Make PR and into Sync Tracker State while preserving pull request creation behavior
- [x] 6.5 Add failing Sync Tracker State tests for receiving pull request data, moving labels from `ready` to `in review`, logging tracker synchronization failures without losing pull request data, and terminal workspace cleanup
- [x] 6.6 Implement the `sync-tracker-state` module and route post-PR terminal cleanup through it
- [x] 6.7 Remove or retire the old `check-pr` routing path after Sync Tracker State owns its responsibilities

## 7. Documentation and Validation

- [x] 7.1 Update project documentation and inline job comments to use target workflow names and queue payload terminology
- [x] 7.2 Update tests that refer to old job names or old payload shapes so they assert the target workflow contract
- [x] 7.3 Run the focused job and type test suites covering routing, payloads, Intake, Prepare Run, Assess, Plan, Develop, Quality Gate, Review, Make PR, and Sync Tracker State
- [x] 7.4 Run `npm test`
- [x] 7.5 Run `npm run lint`
- [x] 7.6 Run `npm run build`
- [x] 7.7 Run `openspec validate align-workflow-target-state --type change --strict --no-interactive`
