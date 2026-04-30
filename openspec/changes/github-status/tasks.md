## 1. GitHub Tracker Primitives

- [ ] 1.1 Add GitHub issue comment helpers for create, update, and list operations scoped to the configured owner and repository.
- [ ] 1.2 Add unit tests for issue comment creation, update, listing, configured repository usage, and error propagation.
- [ ] 1.3 Implement hidden tracker marker rendering and parsing for `kind`, `runId`, `owner`, `repo`, and `issue`.
- [ ] 1.4 Add tests for valid, missing, malformed, duplicated, mismatched, and user-edited tracker markers.
- [ ] 1.5 Implement GitHub status comment recovery behavior for persisted comment id updates, 404 lookup by marker, duplicate marker selection, replacement creation, and non-404 provider failures.

## 2. Tracker Client And Status Model

- [ ] 2.1 Define the flat tracker client interface with `createOrUpdateStatusComment` as the first operation and extension points for future tracker comments and task state transitions.
- [ ] 2.2 Add run summary status metadata types for provider, comment kind, external identity, checklist state, created timestamp, and last-updated timestamp.
- [ ] 2.3 Implement deterministic status item ids and state transitions for `pending`, `in-progress`, `completed`, `retrying`, `blocked`, `failed`, and `skipped`.
- [ ] 2.4 Implement idempotent checklist upsert helpers keyed by stable attempt-aware ids such as `develop:attempt-1` and `review:attempt-2`.
- [ ] 2.5 Add tests for initial checklist creation, state mapping, terminal-vs-retrying failures, and duplicate prevention on repeated updates.

## 3. Status Card Renderer

- [ ] 3.1 Implement GitHub status card rendering with hidden marker, heading, timestamp metadata table, current focus blockquote, progress table, optional review feedback loop table, and optional status note.
- [ ] 3.2 Ensure rendered comments omit visible issue number and run id while preserving machine identity in the hidden marker.
- [ ] 3.3 Render main progress states with icons `✅`, `🔵`, `🟡`, `⚪`, `❌`, `⏭️`, and `🔁` instead of textual completed/pending suffixes.
- [ ] 3.4 Render Review feedback loop rows with status icons in the Review column for changes requested and terminal review failure.
- [ ] 3.5 Add snapshot or string tests for task pickup, Develop in progress, repeated Review rework, terminal Review exhaustion, PR-created tracker warning, and no-change outcomes.

## 4. Run Lifecycle Integration

- [ ] 4.1 Move or add run file set and run summary initialization so Intake creates durable run state before the initial tracker status comment.
- [ ] 4.2 Update Prepare Run to consume the existing initialized run summary and continue repository preparation without being the first owner of run summary creation.
- [ ] 4.3 Store initial tracker status identity and checklist state in the run summary immediately after the status comment is created.
- [ ] 4.4 Add tests covering Intake-created run summary state, Prepare Run compatibility with pre-initialized summaries, and no Redis-only status identity path.

## 5. Stage Flow Status Updates

- [ ] 5.1 Wire Intake to create the initial status comment after issue claim, with `task-pickup:attempt-1` completed and `prepare-run:attempt-1` pending or in progress.
- [ ] 5.2 Wire Prepare Run status updates for preparation in-progress, completed handoff to Assess, and preparation failure.
- [ ] 5.3 Wire Assess and Plan status updates for in-progress, successful handoff, retrying validation, blocked validation exhaustion, and terminal failure paths.
- [ ] 5.4 Wire Develop status updates for initial and rework Develop attempts, deterministic Quality Gate pass, and terminal Quality Gate failure, timeout, or misconfiguration.
- [ ] 5.5 Wire Review status updates for in-progress, success, retrying rework expansion, malformed terminal failure, and exhausted terminal failure.
- [ ] 5.6 Wire Make PR and Sync Tracker State to drive the combined `draft-pr-and-in-review:attempt-1` item, completing it once a PR exists and adding a warning if moving the issue to `in review` fails afterward.
- [ ] 5.7 Ensure status update failures are logged and do not corrupt handoff records or create duplicate checklist rows during worker retries.

## 6. Verification

- [ ] 6.1 Add fake tracker client tests for stage flow update ordering and payloads without calling GitHub.
- [ ] 6.2 Add integration-style tests for repeated status updates to the same comment across Intake, Prepare Run, Develop, Review rework, Make PR, and Sync Tracker State.
- [ ] 6.3 Run the project test suite and update implementation details until the new and existing tests pass.
- [ ] 6.4 Run OpenSpec validation/status checks for `github-status` and resolve any artifact issues.
