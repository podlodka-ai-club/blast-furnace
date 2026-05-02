## 1. Tracker Status Model

- [ ] 1.1 Add `human-review` to the status presentation row kinds and document that `StatusItemStage` is not a workflow routing enum.
- [ ] 1.2 Add optional `reworkAttempt` scope to `StatusChecklistItem` and keep missing scope equivalent to the initial run.
- [ ] 1.3 Update status item id helpers to produce scoped ids for rework rows while preserving existing initial-run ids.
- [ ] 1.4 Add helper functions for creating the full rework status row set for a given `reworkAttempt`.

## 2. Tracker Rendering

- [ ] 2.1 Add renderer tests for a status comment with one rework section whose first row is `🟡 | Human Review | Rework needed |`.
- [ ] 2.2 Add renderer tests for multiple rework attempts with distinct scoped rows.
- [ ] 2.3 Update status comment rendering to group `reworkAttempt > 0` rows into per-rework subsections.
- [ ] 2.4 Ensure rework-scoped rows are excluded from the main progress table and legacy unscoped review feedback loop behavior remains supported.

## 3. Rework Flow Status Updates

- [ ] 3.1 Add PR Rework Intake tests that accepting a qualifying rework trigger updates the existing source-issue status comment with all possible rework rows, including Plan.
- [ ] 3.2 Update PR Rework Intake to initialize the scoped rework status group after route handoff creation and before Prepare Run continues execution.
- [ ] 3.3 Add Prepare Run tests that direct-to-Develop rework marks the scoped Plan row as `skipped` with detail `skipped`.
- [ ] 3.4 Update Prepare Run rework routing to mark scoped Plan skipped when the selected next stage is Develop.
- [ ] 3.5 Update Plan, Develop, Review, Make PR, and Sync Tracker State status updates to use scoped row ids when `reworkAttempt > 0`.

## 4. Regression Coverage

- [ ] 4.1 Add status helper tests proving `plan:attempt-1`, `rework-1:plan:attempt-1`, and `rework-2:plan:attempt-1` are distinct and idempotently upserted.
- [ ] 4.2 Add integration-style rework orchestration coverage for both `ROUTE: PLAN` and `ROUTE: DEVELOP` visible status paths.
- [ ] 4.3 Confirm no code derives workflow routing from `StatusItemStage` or status checklist rows.

## 5. Verification

- [ ] 5.1 Run focused tracker, PR rework intake, Prepare Run, and rework orchestration tests.
- [ ] 5.2 Run the full test suite.
- [ ] 5.3 Run `openspec validate rework-status-comment --strict`.
