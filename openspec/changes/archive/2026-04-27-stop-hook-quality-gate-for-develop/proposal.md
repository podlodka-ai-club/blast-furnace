## Why

The current pipeline runs quality as a separate `quality-gate` stage after Codex has already exited, so failed unit tests are discovered after the agent has lost its active session context. Moving deterministic quality checks into the Codex Stop hook lets the agent receive concise test feedback and fix failures in the same develop session while preserving quality results for downstream stages.

Current pull-request-created workflow:

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

Current no-change workflow terminates in `make-pr` without `sync-tracker-state`.

Target pull-request-created workflow:

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

Target no-change workflow terminates in `make-pr` without `sync-tracker-state`.

Target terminal quality workflow:

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

## What Changes

- Add a deterministic Quality Gate loop inside `develop` that runs the configured target-repository test command from `workspacePath`.
- Run Codex CLI for develop with hooks enabled so the Stop hook can block completion, return quality feedback, and allow Codex to continue in the same session.
- Configure Quality Gate through deployment configuration, including `QUALITY_GATE_TEST_COMMAND` and `QUALITY_GATE_TEST_TIMEOUT_MS` with a 180 second default timeout.
- Treat missing Quality Gate command configuration as `misconfigured` and block successful progression instead of guessing a test command.
- Limit Stop-hook blocking to two failed quality attempts; on a third failure, allow Codex to stop and record terminal failed quality.
- Preserve `quality` as a domain output in the handoff ledger, including status, command, exit code, attempts, duration, summary, and optional output artifact path.
- Route successful develop output directly to `review` only when quality passes.
- Stop the happy-path pipeline when quality is `failed`, `misconfigured`, or `timed-out` after retries, with an explicit non-successful develop/quality outcome in handoff state.
- **BREAKING**: Remove `quality-gate` as a standalone BullMQ workflow stage/job from the normal pipeline.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `develop-job`: Develop owns the Stop-hook quality loop, writes both `development` and `quality` output, enqueues `review` only after passed quality, and records terminal quality failure states without handing off to the happy path.
- `quality-gate-job`: The standalone `quality-gate` BullMQ stage/job is removed from the normal workflow; quality evaluation is no longer performed by a separate stage after develop exits.
- `job-queue`: Worker routing and stage transitions no longer include `quality-gate` in the forward path, and the develop-to-review transition carries a handoff record containing quality output.
- `review-job`: Review receives quality data from develop's handoff record rather than from a `quality-gate` stage, and only runs after passed quality.
- `run-handoff-ledger`: Handoff schemas and run summary status semantics distinguish passed develop output from terminal quality failure states and retain quality result details for downstream consumers and diagnostics.
- `runtime-server`: Runtime configuration loads deterministic Quality Gate command settings and timeout defaults for deployed orchestrator instances.

## Impact

- Affects `src/jobs/develop.ts`, the Codex CLI invocation, Stop-hook runtime configuration, and any generated hook scripts/state used by develop.
- Affects stage payload types and workflow stage unions that currently include `quality-gate` as a forward stage.
- Affects worker routing and any tests expecting `intake -> prepare-run -> assess -> plan -> develop -> quality-gate -> review -> make-pr -> sync-tracker-state`.
- Affects handoff validation schemas and stage output contracts so `quality` remains available even though the producing stage becomes `develop`.
- Affects configuration loading and documentation for target repository onboarding because Quality Gate commands are deterministic deployment settings, not agent-selected commands.
- Requires smoke or integration coverage for Codex Stop-hook behavior with `codex exec --enable codex_hooks` on `gpt-5.4`.
