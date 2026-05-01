## 1. Workflow Types, Config, And Contracts

- [x] 1.1 Add failing tests for `pr-rework-intake` workflow stage typing, worker routing, queue payload validation, and `MAX_HUMAN_REWORK_ATTEMPTS` default/config parsing.
- [x] 1.2 Add `pr-rework-intake` to workflow stage types, worker routing, stage payload validation, status/run summary types, and configuration with `MAX_HUMAN_REWORK_ATTEMPTS` defaulting to `3`.
- [x] 1.3 Add failing handoff contract tests for PR Rework Intake records, rework Prepare Run records, terminal PR lifecycle records, no-comment trigger records, and recoverable pending-next-stage metadata.
- [x] 1.4 Extend handoff validation and run summary pointer handling for PR Rework Intake, rework Prepare Run dependencies, pending next-stage recovery, and `stageAttempt: 1` rework entry.

## 2. GitHub PR Rework Integration

- [x] 2.1 Add failing GitHub integration tests for reading PR state with merge/closed/head data, removing `Rework` idempotently, listing PR review comments, and listing PR-level comments.
- [x] 2.2 Implement GitHub helpers for configured-repository PR polling, PR label removal, PR review comments, and PR-level comments with author, location, active/resolved/outdated/deleted metadata.
- [x] 2.3 Add failing comment filtering/rendering tests for excluding Blast Furnace-authored, `Bot`, outdated, resolved, and deleted comments, and for omitting missing `File`/`Line` fields.
- [x] 2.4 Implement comment normalization, filtering, time-window selection, and markdown rendering for PR Rework Intake.

## 3. PR Rework Intake

- [x] 3.1 Add failing PR Rework Intake tests for idle polling, merged PR terminal success, closed-without-merge termination, too-many-reworks termination with issue comment, no-comment trigger consumption, and route handoff creation.
- [x] 3.2 Implement the isolated PR Rework Intake job module with per-run polling, PR lifecycle handling, attempt-limit enforcement, comment collection, route prompt rendering, Codex route analysis, and Prepare Run delegation.
- [x] 3.3 Add failing idempotency tests for duplicate delayed jobs, active per-run lock or durable in-progress marker, already-appended handoff recovery, and crash-after-append enqueue recovery.
- [x] 3.4 Implement PR Rework Intake concurrency control and recoverable handoff append plus next-job enqueue.
- [x] 3.5 Add failing tests for latest accepted Plan resolution across original plan, Plan-routed reworks, and Develop-only reworks.
- [x] 3.6 Implement latest accepted Plan resolution and previous rework trigger timestamp lookup from the ledger.

## 4. Prepare Run Rework Mode

- [x] 4.1 Add failing Prepare Run tests for rework payload validation, PR Rework Intake handoff consumption, fork/head repository rejection, branch checkout from existing PR head, expected SHA reset, and `stageAttempt: 1` forwarding.
- [x] 4.2 Implement Prepare Run rework mode while preserving initial Intake-to-Assess behavior.
- [x] 4.3 Add failing tests for run summary current workspace replacement only after successful rework workspace preparation and cleanup on failed preparation.
- [x] 4.4 Implement current workspace pointer updates and rework preparation failure cleanup.

## 5. Plan And Develop Rework Prompts

- [x] 5.1 Add failing Plan tests for consuming rework Prepare Run handoffs, resolving PR Rework Intake comments, resolving latest accepted Plan content, rendering `prompts/plan-rework.md`, and handing accepted rework plans to Develop.
- [x] 5.2 Implement Plan human rework mode and add `prompts/plan-rework.md`.
- [x] 5.3 Add failing Develop tests for direct PR Rework Intake input through Prepare Run, required dependency validation, rendering `prompts/develop-rework.md` with `reviewContent`, and rejecting unsupported direct inputs.
- [x] 5.4 Implement Develop direct human PR rework mode and add `prompts/develop-rework.md`.
- [x] 5.5 Add failing tests that rework Plan and Develop paths preserve `stageAttempt: 1`, propagate the incremented `reworkAttempt`, and continue through Quality Gate and Review.
- [x] 5.6 Implement stage attempt and rework attempt propagation for Plan, Develop, and Review rework paths.

## 6. Make PR And Sync Tracker State Rework Finalization

- [x] 6.1 Add failing Make PR tests for rework review input resolution, existing PR branch finalization, no-new-PR behavior, and no-change rework handoff to Sync Tracker State.
- [x] 6.2 Implement Make PR rework finalization against the existing pull request branch.
- [x] 6.3 Add failing Make PR branch-safety tests for fork PR rejection, unexpected head repository, unexpected branch, unexpected head SHA, and non-fast-forward refetch/retry exhaustion.
- [x] 6.4 Implement existing-PR head repository/branch/SHA validation and bounded non-fast-forward refetch/retry handling.
- [x] 6.5 Add failing Sync Tracker State tests for post-initial-PR scheduling of PR Rework Intake, rework label removal, source issue `in review` transition, no-change rework cleanup, and not closing the run itself.
- [x] 6.6 Implement Sync Tracker State rework side effects, workspace cleanup, tracker-sync handoff updates, and PR Rework Intake scheduling.

## 7. End-To-End Verification

- [x] 7.1 Add failing orchestration tests for initial PR creation leading to PR Rework Intake polling instead of terminal completion.
- [x] 7.2 Add failing orchestration tests for Rework label to Prepare Run to Plan route to Develop to Review to Make PR to Sync Tracker State.
- [x] 7.3 Add failing orchestration tests for Rework label to direct Develop route through Quality Gate and Review.
- [x] 7.4 Add failing orchestration tests for merged PR success closure, closed-without-merge termination, too-many-reworks termination, and no-comment trigger consumption.
- [x] 7.5 Implement any remaining orchestration wiring needed for end-to-end rework flows.
- [x] 7.6 Run `npm test` and `npm run build`; fix failures while preserving the red-test-before-implementation order captured in the tasks above.
- [x] 7.7 Run `openspec validate rework-implementation --strict` and confirm the change remains valid.
