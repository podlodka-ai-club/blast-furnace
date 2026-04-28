## 1. Contract Tests

- [x] 1.1 Add failing handoff contract tests proving records omit `nextInput`, use `dependsOn` arrays, and still return an `inputRecordRef` for queue scheduling.
- [x] 1.2 Add failing stage output schema tests proving stage outputs reject stable run context and outputs produced by earlier stages.
- [x] 1.3 Add failing run summary tests proving stable run context stores issue, repository, branch name, and workspace path without duplicating stage output data.
- [x] 1.4 Add failing context resolver tests for missing, wrong-stage, wrong-record, and invalid-output dependency ids.
- [x] 1.5 Add failing job flow tests proving downstream queue payloads are built from append results rather than persisted `nextInput`.

## 2. Handoff and Run State Models

- [x] 2.1 Update `HandoffRecord` and related runtime schemas to remove `nextInput` and make `dependsOn` a dependency record id array.
- [x] 2.2 Update append helpers to accept explicit dependency record ids, write `dependsOn: []` for the first record, and validate dependency id shape.
- [x] 2.3 Add a stable run context shape to `RunSummaryData` for issue, configured repository identity, branch name, and workspace path.
- [x] 2.4 Add run summary helper behavior for initializing and updating stable run context without replacing prepared branch or workspace fields during normal handoff updates.
- [x] 2.5 Update handoff record validation to reject output objects that include stable run context or prior stage output fields.

## 3. Stage-Local Output Schemas

- [x] 3.1 Update Prepare Run output schema so its handoff output is stage-local and stable branch/workspace context is stored in `run.json`.
- [x] 3.2 Update Assess output schema to contain only assessment output and attempt/status metadata.
- [x] 3.3 Update Plan output schema to contain only plan attempt output and attempt/status metadata.
- [x] 3.4 Update Develop output schema to contain only development and quality output.
- [x] 3.5 Update Review output schema to contain only review output.
- [x] 3.6 Update Make PR output schema to contain only no-change or pull request result output.
- [x] 3.7 Update Sync Tracker State output schema to contain only tracker synchronization output.

## 4. Context Resolution

- [x] 4.1 Implement shared helpers to read stable run context from the run summary using an input record reference.
- [x] 4.2 Implement shared helpers to load JSONL handoff records by dependency record id and validate `recordId` and `fromStage`.
- [x] 4.3 Implement typed context resolver for Assess using stable run context and the direct Prepare Run input record.
- [x] 4.4 Implement typed context resolver for Plan using stable run context and the Assess handoff output.
- [x] 4.5 Implement typed context resolver for Develop using stable run context and the accepted Plan handoff output.
- [x] 4.6 Implement typed context resolver for Review using stable run context, Develop output, and accepted Plan output.
- [x] 4.7 Implement typed context resolver for Make PR using stable run context, Review output, and required Develop/Quality output.
- [x] 4.8 Implement typed context resolver for Sync Tracker State using stable run context and Make PR pull request output.

## 5. Job Module Migration

- [x] 5.1 Update Prepare Run to persist stable run context and append a stage-local Prepare Run handoff record with an empty dependency list.
- [x] 5.2 Update Assess to consume its resolver context, append assessment-only output, and depend on the direct Prepare Run input record.
- [x] 5.3 Update Plan to consume its resolver context, append plan-only attempt outputs, and preserve Plan retry dependency chaining with references.
- [x] 5.4 Update Develop to consume accepted Plan plus stable run context, append development/quality-only output, and enqueue Review from the append result.
- [x] 5.5 Update Review to consume Develop, Quality, Plan, and stable run context, append review-only output, and record explicit dependencies for Make PR.
- [x] 5.6 Update Make PR to consume Review, Develop/Quality, and stable run context, append make-pr-only output, and record explicit dependencies for Sync Tracker State when a PR is created.
- [x] 5.7 Update Sync Tracker State to consume pull request output plus stable run context and append tracker-only terminal output.

## 6. Verification and Cleanup

- [x] 6.1 Update existing job tests that assert cumulative output snapshots to assert stage-local output and explicit dependencies instead.
- [x] 6.2 Update orchestration and handoff contract tests that currently expect `nextInput`.
- [x] 6.3 Run focused tests for orchestration, handoff contracts, stage payloads, and each affected job module.
- [x] 6.4 Run the full test suite with `npm test`.
- [x] 6.5 Run lint with `npm run lint`.
- [x] 6.6 Document the migration expectation for in-flight old-contract jobs as queue drain or temporary dual-reader support before deployment.
