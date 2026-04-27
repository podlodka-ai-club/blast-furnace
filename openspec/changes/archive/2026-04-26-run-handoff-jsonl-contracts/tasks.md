## 1. Run File Set Infrastructure

- [x] 1.1 Add failing tests for timestamped run directory, run summary, and handoff ledger path resolution using `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/`
- [x] 1.2 Implement run file set helpers that compute the timestamp prefix once and resolve `<YYYY-MM-DD_HH.MM_runId>_run.json` and `<YYYY-MM-DD_HH.MM_runId>_handoff.jsonl`
- [x] 1.3 Add failing tests proving run summary persists the timestamp prefix, run directory, run summary path, and handoff ledger path
- [x] 1.4 Update run summary types and read/write helpers to store run status, current stage, stage attempt statuses, attempt counters, handoff ledger path, and latest handoff record pointer

## 2. Handoff Ledger Contracts

- [x] 2.1 Add failing tests for appending one JSON object per line to the run handoff ledger without overwriting existing records
- [x] 2.2 Implement handoff ledger append/read helpers with monotonic `sequence`, stable `recordId`, `dependsOn`, `fromStage`, `toStage`, attempts, `output`, and `nextInput`
- [x] 2.3 Add runtime schemas for input record references, handoff records, run summary pointers, and transport-only stage queue payloads
- [x] 2.4 Add runtime schemas for `Prepare Run`, `Assess`, `Plan`, `Develop`, `Quality Gate`, `Review`, `Make PR`, and `Sync Tracker State` output objects
- [x] 2.5 Add validation helpers that reject mismatched `runId`, `toStage`, `stageAttempt`, or `reworkAttempt` before a stage performs work

## 3. Queue Payload Migration

- [x] 3.1 Add failing tests showing downstream stage payloads exclude issue, repository, branch, workspace, plan, development, quality, review, and pull request business fields
- [x] 3.2 Update shared stage payload types to use `inputRecordRef` for stages after `prepare-run`
- [x] 3.3 Update queue payload construction helpers to enqueue downstream stages with only transport metadata and the new input record reference
- [x] 3.4 Preserve the Prepare Run bootstrap payload from Intake with issue and configured repository identity

## 4. Stage Flow Migration

- [x] 4.1 Update Prepare Run tests and implementation to initialize the timestamped run file set, write the initial run summary, append the first `prepare-run` to `assess` handoff record, and enqueue Assess with `inputRecordRef`
- [x] 4.2 Update Assess tests and implementation to read prepared context from the ledger, append validated assessment output, update run summary, and enqueue Plan with `inputRecordRef`
- [x] 4.3 Update Plan tests and implementation to read assessment context from the ledger, append validated plan output, update run summary, and enqueue Develop with `inputRecordRef`
- [x] 4.4 Update Develop tests and implementation to read issue, workspace, and plan context from the ledger, append validated development output after executor success, update run summary, and enqueue Quality Gate with `inputRecordRef`
- [x] 4.5 Update Quality Gate tests and implementation to read development context from the ledger, append validated quality output, update run summary, and enqueue Review with `inputRecordRef`
- [x] 4.6 Update Review tests and implementation to read quality context from the ledger, append validated review output, update run summary, and enqueue Make PR with `inputRecordRef`
- [x] 4.7 Update Make PR tests and implementation to read reviewed context from the ledger, append validated pull-request or no-change output, update run summary, and enqueue Sync Tracker State only for pull-request-created output
- [x] 4.8 Update Sync Tracker State tests and implementation to read pull request context from the ledger, append validated tracker-sync output, perform cleanup, and mark the run complete in the run summary

## 5. Cleanup And Verification

- [x] 5.1 Remove or stop using per-stage JSON artifact writes for handoff data while preserving non-handoff logs and operational files
- [x] 5.2 Update existing tests that asserted transitional business fields in queue payloads to assert JSONL record contents and `inputRecordRef` instead
- [x] 5.3 Run `npm test` and fix any regressions
- [x] 5.4 Run `npm run lint` and fix any lint violations
- [x] 5.5 Run `openspec validate "run-handoff-jsonl-contracts" --type change --strict`
