## Context

The current pull-request-created workflow is:

```text
intake
  -> prepare-run
  -> assess
  -> plan
  -> develop
  -> quality-gate
  -> review
  -> make-pr
  -> sync-tracker-state
```

The current no-change workflow terminates in `make-pr` without `sync-tracker-state`.

`develop` runs Codex in the prepared target repository workspace, appends a development-only handoff record, and enqueues a separate `quality-gate` BullMQ job. The current `quality-gate` job is stub-safe: it appends a passing quality result without running target repository tests, then enqueues `review`.

This change makes quality evaluation part of `develop` because the useful recovery point for failing unit tests is the active Codex session, not a later queue stage. Quality Gate is deterministic deployment configuration: it runs the configured test command from the target repository `workspacePath`, never from the Blast Furnace repository, and the agent does not choose or guess the command.

The target pull-request-created workflow is:

```text
intake
  -> prepare-run
  -> assess
  -> plan
  -> develop
       -> Codex works
       -> Stop hook runs Quality Gate
       -> if failed: block stop and return test feedback to Codex
       -> Codex fixes in the same session
       -> Stop hook runs Quality Gate again
       -> Quality Gate passes
  -> review
  -> make-pr
  -> sync-tracker-state
```

The target no-change workflow terminates in `make-pr` without `sync-tracker-state`.

The target terminal quality workflow is:

```text
intake
  -> prepare-run
  -> assess
  -> plan
  -> develop
       -> Codex works
       -> Stop hook runs Quality Gate
       -> quality failed, timed out, or is misconfigured after allowed remediation
       -> develop records terminal quality output
       -> no review, make-pr, or sync-tracker-state job is enqueued
```

## Goals / Non-Goals

**Goals:**

- Run the configured target-repository unit test command from `workspacePath` before develop can complete successfully.
- Use Codex Stop hooks so failed quality feedback is returned to Codex as continuation context in the same session.
- Bound Stop-hook remediation to two blocking failures, with the third failure recorded as terminal quality failure.
- Preserve `quality` as a structured domain result in the handoff ledger even though `quality-gate` is no longer a separate stage.
- Move the happy path to `intake -> prepare-run -> assess -> plan -> develop -> review -> make-pr -> sync-tracker-state`, with `review` only reached after passed quality.
- Record misconfigured, failed, and timed-out quality outcomes as explicit non-successful develop terminal states.
- Keep full command output out of the JSONL ledger by storing it as a run-scoped artifact and embedding only a bounded summary plus artifact path.

**Non-Goals:**

- Do not run Blast Furnace's own tests as the Quality Gate.
- Do not let Codex select, rewrite, or infer the test command.
- Do not support interactive, browser/UI, manual-auth, or externally dependent test flows in Quality Gate.
- Do not pin the Codex CLI version as part of this change.
- Do not introduce a general review/rework loop beyond the Stop-hook quality loop inside `develop`.
- Do not move commit, push, pull request creation, or tracker synchronization out of their existing deterministic stages.

## Decisions

### Develop Owns Quality Output

`develop` becomes the producer of both `development` and `quality` output. On a passed Quality Gate, Develop appends a handoff record with `fromStage: 'develop'`, `toStage: 'review'`, `status: 'success'`, and an output object that contains issue, repository, branch, workspace, assessment, plan, development, and quality data.

When quality is terminally unsuccessful, Develop appends a terminal handoff record with `toStage: null`. The handoff record status should be `failure` for `failed` and `timed-out` quality results, and `blocked` for `misconfigured` results. The run summary should use an explicit run status such as `quality-failed`, `quality-timed-out`, or `quality-misconfigured` so operators can distinguish these outcomes from a successful develop handoff.

The `QualityGateResult` contract expands to:

```ts
type QualityGateStatus = 'passed' | 'failed' | 'misconfigured' | 'timed-out';

interface QualityGateResult {
  status: QualityGateStatus;
  command: string;
  exitCode?: number;
  attempts: number;
  durationMs: number;
  summary: string;
  outputPath?: string;
}
```

`DevelopOutput` should require `quality` once Develop appends a completion handoff. The separate `QualityGateOutput` and `QualityGateJobData` types can be removed from the active workflow, or left only as legacy/archive-only types if an implementation needs temporary compatibility while tests are migrated.

Alternative considered: keep the `quality-gate` job and have it resume Codex on failure. That keeps the stage topology smaller to change, but it cannot preserve the same Codex session context and fails the main requirement.

### Deterministic Quality Runner

Add a small Quality Gate runner owned by the develop implementation. It reads:

- `QUALITY_GATE_TEST_COMMAND`, optional string.
- `QUALITY_GATE_TEST_TIMEOUT_MS`, optional integer defaulting to `180000`.

The command is trusted operator/deployment configuration, not issue text and not agent output. Empty or missing command produces a `misconfigured` quality result without running tests and without trying remediation.

The runner executes the command in `workspacePath`, captures stdout and stderr, measures duration, enforces the timeout, and writes full output to a run-scoped artifact such as:

```text
.orchestrator/runs/<timestamp_runId>/quality/attempt-<n>.log
```

The ledger result stores the command, status, exit code when available, attempt count, duration, compact summary, and output path. The runner should use standard Node process execution primitives and avoid new dependencies unless command parsing becomes a proven problem. Because the command is trusted configuration, shell execution is acceptable if needed to support normal deployment commands such as `npm test`, but docs must make clear that this is not user-controlled input.

Alternative considered: infer commands from target repository files such as `package.json`. That creates nondeterminism and lets repository shape rather than deployment policy define the gate, so it is rejected.

### Codex Stop Hook Integration

Develop should launch Codex with hooks enabled. For Codex-looking commands, `buildCodexCliArgs` should add `exec` when needed as today and also include `--enable codex_hooks` unless the configured invocation already enables hooks. The default model remains `gpt-5.4`, and the CLI version remains unpinned.

Hook installation should be isolated behind a small adapter, for example `prepareDevelopStopHook(...)`, so future Codex CLI hook configuration changes are localized. The adapter prepares run-scoped hook state and exposes the Quality Gate hook runner to Codex using the CLI-supported hook configuration mechanism. The implementation must be covered by a smoke or integration test that verifies real Stop-hook blocking behavior with `codex exec --enable codex_hooks`.

The Stop hook algorithm is:

1. Load persistent hook state from the run directory.
2. If a nested or already-active hook invocation is detected through state and the hook input's `stop_hook_active` signal, do not start another test command or return an unbounded new block.
3. If the Quality Gate command is missing, persist a `misconfigured` result and allow Codex to stop.
4. Run the Quality Gate command and persist the attempt result.
5. If quality passed, allow Codex to stop.
6. If quality failed or timed out and fewer than two failures have been blocked, return:

   ```json
   {
     "decision": "block",
     "reason": "Quality Gate failed...\n<bounded feedback>"
   }
   ```

7. If this is the third failed or timed-out attempt, allow Codex to stop and persist terminal failed quality.

The persistent hook state should include at least attempt count, blocked failure count, last quality result, output paths, and an active guard. BullMQ retry metadata must not drive these counters.

Alternative considered: run tests after the Codex process exits from the Develop flow. That would be simpler to implement, but Codex would no longer receive failure feedback in the same session.

### Feedback Shape

The continuation prompt should be compact and actionable. It should include:

- command;
- status and exit code when present;
- duration;
- latest relevant stdout/stderr lines with a size cap;
- failing test names when they can be extracted cheaply from common output formats.

The hook should not paste full test logs into the continuation prompt or JSONL ledger. Full output belongs in the artifact file.

Alternative considered: return the complete combined stdout/stderr to Codex. That risks oversized prompts and noisy retries, so only bounded summaries should be returned.

### Stage Topology And Validation

Remove `quality-gate` from active forward workflow routing. `WORKFLOW_STAGES`, stage payload schemas, worker routing, and stage output schemas should reflect that `review` now receives a handoff record produced by `develop`.

`review` should parse a Develop output that contains passed quality. It should fail validation if invoked with missing quality or non-passed quality because the normal pipeline must not review or make a pull request for a terminal quality failure.

Terminal quality failures should still be durable handoff records so diagnostics and later operator tooling can inspect the result. They should not produce `nextInput`, and no `review` job should be enqueued.

Alternative considered: keep `quality-gate` in `WORKFLOW_STAGES` but never schedule it. That leaves a misleading active contract and makes tests/docs continue to imply a stage that no longer exists.

### Documentation And Onboarding

README, project docs, and target repository onboarding docs should describe the Quality Gate command contract:

- configured per deployed orchestrator instance;
- run from the target repository root;
- non-interactive;
- unit-test oriented;
- returns non-zero on failure;
- does not require browser/UI/manual auth;
- does not require external services unless deterministic setup is handled separately;
- times out after `QUALITY_GATE_TEST_TIMEOUT_MS`, default `180000`.

Alternative considered: document the command only in environment variable tables. That is not enough because target repository owners need to know what command shape the orchestrator expects.

## Risks / Trade-offs

- Codex hook configuration may change because the CLI is not pinned -> isolate hook setup behind an adapter and require a smoke/integration test for Stop-hook block behavior.
- The configured test command may hang or produce huge output -> enforce timeout, kill the process, cap summaries, and store full output as an artifact.
- Missing Quality Gate configuration would otherwise create false confidence -> treat it as `misconfigured` and stop the happy path.
- Shell execution of the configured command is powerful -> only accept deployment configuration, never issue or agent-provided command text, and document the trust boundary.
- Terminal quality failure records may look like Develop completed because the Codex process exits successfully -> use explicit output/run statuses and no `nextInput`.
- Removing the `quality-gate` job can break in-flight queued jobs -> deploy only after draining local queues or accepting that old `quality-gate` jobs will fail as unknown job types.

## Migration Plan

1. Add Quality Gate configuration parsing and types while keeping the command optional at startup.
2. Add the Quality Gate runner with unit coverage for pass, fail, timeout, misconfigured command, summary truncation, and artifact writing.
3. Add the Stop-hook adapter/state handling and unit coverage for two blocking failures, third terminal failure, pass, misconfiguration, and active-hook guard behavior.
4. Update Develop Codex argument construction to enable `codex_hooks` and pass hook environment/state into the Codex process.
5. Change Develop handoff behavior so the full successful workflow becomes `intake -> prepare-run -> assess -> plan -> develop -> review -> make-pr -> sync-tracker-state`, with Develop appending `develop -> review` on passed quality and terminal `develop -> null` records for failed, timed-out, or misconfigured quality.
6. Update Review, Make PR, handoff schemas, worker routing, workflow stage types, and tests to remove the active `quality-gate` stage.
7. Retire or delete the standalone `src/jobs/quality-gate.ts` module and tests once no active references remain.
8. Update README/project onboarding docs for Quality Gate configuration and target repository command requirements.
9. Add smoke or integration coverage for real Codex Stop-hook behavior with `codex exec --enable codex_hooks` on `gpt-5.4`.

Rollback before deployment is code-only. After deployment, rollback requires draining or explicitly handling in-flight jobs because the successful stage topology changes from `intake -> prepare-run -> assess -> plan -> develop -> review -> make-pr -> sync-tracker-state` back to `intake -> prepare-run -> assess -> plan -> develop -> quality-gate -> review -> make-pr -> sync-tracker-state`.

## Open Questions

- Should the real Codex Stop-hook smoke test run by default in CI, or be gated behind an explicit environment variable because it depends on an installed Codex CLI and model access?
