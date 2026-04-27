## 1. Runtime Configuration And Contracts

- [x] 1.1 Add failing config tests for `QUALITY_GATE_TEST_COMMAND`, default `QUALITY_GATE_TEST_TIMEOUT_MS=180000`, invalid timeout fallback, and startup without a Quality Gate command.
- [x] 1.2 Extend runtime config types and loader to expose optional Quality Gate command settings without requiring the command at startup.
- [x] 1.3 Add failing type and contract tests for removing `quality-gate` from active workflow stages and stage payload schemas.
- [x] 1.4 Update shared workflow stage types, stage payload validation, and worker routing types so active forward routing is `intake -> prepare-run -> assess -> plan -> develop -> review -> make-pr -> sync-tracker-state`.
- [x] 1.5 Add failing handoff contract tests for expanded `QualityGateResult`, Develop outputs with `quality`, terminal quality statuses, and Review accepting only passed quality from Develop.
- [x] 1.6 Update handoff output schemas so Develop requires `quality` on completion records and Review validates a Develop-produced passed quality input.

## 2. Quality Gate Runner

- [x] 2.1 Add failing unit tests for a Quality Gate runner that executes the configured command from the target repository `workspacePath`.
- [x] 2.2 Add failing runner tests for passed, failed, timed-out, and misconfigured outcomes with `command`, `exitCode`, `attempts`, `durationMs`, `summary`, and optional `outputPath`.
- [x] 2.3 Add failing runner tests proving full stdout/stderr is written to a run-scoped artifact outside the target repository workspace and only bounded summary data is returned.
- [x] 2.4 Implement the Quality Gate runner with timeout enforcement, stdout/stderr capture, duration measurement, output artifact writing, and bounded feedback summary generation.
- [x] 2.5 Add failing summary tests for recent stdout/stderr lines and cheap failing test name extraction from common test output.
- [x] 2.6 Implement summary truncation and failing test name extraction without putting full command output in the JSONL ledger.

## 3. Stop Hook Adapter And State

- [x] 3.1 Add failing tests for run-scoped Stop-hook state persistence, including attempt count, blocked failure count, last quality result, output paths, and active guard.
- [x] 3.2 Add failing Stop-hook tests for first and second quality failures returning `decision: "block"` with bounded feedback.
- [x] 3.3 Add failing Stop-hook tests for the third failed or timed-out attempt allowing stop and persisting terminal failed quality.
- [x] 3.4 Add failing Stop-hook tests for passed quality allowing stop and missing command recording `misconfigured` without remediation loops.
- [x] 3.5 Add failing Stop-hook tests proving `stop_hook_active` or active run state does not start recursive Quality Gate commands.
- [x] 3.6 Implement the Stop-hook adapter and state helpers behind a small Develop-owned interface.
- [x] 3.7 Add failing Codex argument tests proving `--enable codex_hooks` is added for Codex-looking invocations when not already enabled.
- [x] 3.8 Update Develop Codex command construction and process environment to pass run-scoped hook configuration into the Codex CLI invocation.

## 4. Develop Flow Integration

- [x] 4.1 Add failing Develop flow tests for passed quality appending a `develop -> review` handoff with `development` and `quality`, then enqueueing `review`.
- [x] 4.2 Add failing Develop flow tests proving passed quality never enqueues `quality-gate` and never commits, pushes, creates PRs, transitions tracker state, or performs terminal cleanup.
- [x] 4.3 Add failing Develop flow tests for missing Quality Gate command appending terminal `quality-misconfigured` output and no downstream job.
- [x] 4.4 Add failing Develop flow tests for terminal failed and timed-out quality appending `toStage: null`, `nextInput: null`, and no `review`, `make-pr`, or `sync-tracker-state` jobs.
- [x] 4.5 Implement Develop flow changes to read the final Stop-hook quality result, append the correct handoff record, update run summary status, and schedule only the allowed next job.
- [x] 4.6 Update Develop executor failure handling tests to confirm Codex process failures and Codex executor timeout still fail the Develop job before handoff.

## 5. Remove Standalone Quality Gate Stage

- [x] 5.1 Update worker routing tests so `quality-gate` is no longer a known active workflow job type.
- [x] 5.2 Remove `quality-gate` from active `WORKFLOW_STAGES`, stage payload schemas, stage output schemas, and active job data exports.
- [x] 5.3 Retire or delete the standalone `src/jobs/quality-gate.ts` implementation and its tests after Develop owns quality output.
- [x] 5.4 Update Review tests so Review reads quality data from a Develop-produced handoff record and rejects missing or non-passed quality.
- [x] 5.5 Update Review implementation to parse Develop output with passed quality before appending review output and enqueueing Make PR.
- [x] 5.6 Update downstream tests that construct handoff chains so Make PR and Sync Tracker State still operate after `develop -> review -> make-pr`.

## 6. Documentation And Smoke Coverage

- [x] 6.1 Update README configuration tables and Codex Execution documentation for `QUALITY_GATE_TEST_COMMAND`, `QUALITY_GATE_TEST_TIMEOUT_MS`, and `codex exec --enable codex_hooks`.
- [x] 6.2 Update project/onboarding documentation to state that the Quality Gate command runs from target repository root, is non-interactive, runs unit tests, returns non-zero on failure, avoids UI/browser/manual auth, and has deterministic service setup.
- [x] 6.3 Add smoke or integration coverage for real Codex Stop-hook block behavior with `codex exec --enable codex_hooks` on `gpt-5.4`, gated when external CLI/model access is not available by default.
- [x] 6.4 Document the deployment migration note that old queued `quality-gate` jobs must be drained or explicitly handled before rolling out the new topology.

## 7. Verification

- [x] 7.1 Run focused Vitest suites for config, types, stage payloads, handoff contracts, Develop, Review, worker routing, and removed Quality Gate behavior.
- [x] 7.2 Run `npm test` and `npm run lint`.
- [x] 7.3 Run `openspec validate stop-hook-quality-gate-for-develop --type change --strict --no-interactive`.
- [x] 7.4 Confirm `openspec status --change stop-hook-quality-gate-for-develop` reports all artifacts complete before implementation begins.
