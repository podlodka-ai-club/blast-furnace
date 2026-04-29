## MODIFIED Requirements

### Requirement: Develop Job Module
The system SHALL provide a `develop` job handled by an isolated Develop module that reads stable run context from the run summary, reads accepted plan output from the JSONL ledger, owns Codex executor invocation and the deterministic Quality Gate Stop-hook loop, and appends formal development and quality output without owning repository or workspace preparation.

#### Scenario: Develop receives planned run data
- **WHEN** a `develop` job runs
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `develop`
- **AND** Develop SHALL read issue data, configured repository identity, branch name, and workspace path from stable run context in the run summary
- **AND** Develop SHALL read accepted plan data from the referenced Plan handoff record
- **AND** Develop SHALL NOT require assessment data in its stage input context

#### Scenario: Repository preparation is not repeated
- **WHEN** Develop starts
- **THEN** it SHALL use the workspace path read from stable run context and prepared by Prepare Run
- **AND** SHALL NOT create the workspace
- **AND** SHALL NOT clone the repository
- **AND** SHALL NOT create, fetch, check out, or reset the issue branch as repository preparation work

#### Scenario: Codex command is built
- **WHEN** `CODEX_CLI_PATH` is configured as a command with optional arguments
- **THEN** Develop SHALL split it into executable and arguments
- **AND** reject an empty command
- **AND** add `exec` when the command appears to be Codex and no explicit Codex subcommand is present
- **AND** add `--dangerously-bypass-approvals-and-sandbox` when absent
- **AND** add `--enable codex_hooks` when the command appears to be Codex and hooks are not already enabled
- **AND** add the configured Codex model when no explicit model argument is present
- **AND** append a prompt containing the available plan context

#### Scenario: Executor process runs
- **WHEN** the Codex command is launched
- **THEN** Develop SHALL run it through `node-pty` in the prepared workspace
- **AND** pass through the current process environment plus run-scoped Stop-hook configuration
- **AND** stream non-empty PTY output to the job logger
- **AND** enforce the configured Codex executor timeout

#### Scenario: Quality Gate command is required
- **WHEN** the Stop hook runs and `QUALITY_GATE_TEST_COMMAND` is unset or empty
- **THEN** Develop SHALL record a quality result with `status: "misconfigured"`
- **AND** the result SHALL include an empty command value, `attempts`, `durationMs`, and a summary naming the missing configuration
- **AND** Develop SHALL append a terminal handoff record
- **AND** the Develop output status SHALL be `quality-misconfigured` to distinguish it from successful develop output
- **AND** SHALL NOT enqueue `review`, `make-pr`, or `sync-tracker-state`

#### Scenario: Quality Gate command runs in target workspace
- **WHEN** the Stop hook runs Quality Gate
- **THEN** it SHALL execute the configured `QUALITY_GATE_TEST_COMMAND` from the target repository `workspacePath`
- **AND** SHALL NOT run Blast Furnace's own tests unless Blast Furnace is the configured target repository workspace
- **AND** SHALL enforce `QUALITY_GATE_TEST_TIMEOUT_MS`, defaulting to 180000 milliseconds
- **AND** SHALL capture stdout and stderr for the attempt
- **AND** SHALL write full command output to a run-scoped artifact file outside the target repository workspace
- **AND** SHALL record only a bounded summary and optional output artifact path in the handoff ledger

#### Scenario: Stop hook runner is reusable
- **WHEN** Develop prepares Codex Stop-hook configuration
- **THEN** it SHALL point the hook command at the reusable Stop-hook runner from the Blast Furnace codebase
- **AND** SHALL NOT generate a per-run `quality/stop-hook.mjs` script
- **AND** SHALL pass run-specific state path, run directory, workspace path, Quality Gate command, and timeout through environment variables

#### Scenario: Quality Gate passes
- **WHEN** Codex attempts to stop and Quality Gate exits with code `0`
- **THEN** the Stop hook SHALL allow Codex to stop
- **AND** Develop SHALL append a handoff record from `develop` to `review`
- **AND** the output SHALL include `development` and `quality`
- **AND** the output SHALL NOT include plan, assessment, review, pull request, tracker synchronization, or stable run context data
- **AND** `quality.status` SHALL be `passed`
- **AND** `quality` SHALL include `command`, `exitCode`, `attempts`, `durationMs`, and `summary`
- **AND** the handoff `quality` object SHALL NOT include `outputPath` for a passed Quality Gate result
- **AND** Develop SHALL remove run-scoped Quality Gate runtime artifacts after the successful Develop handoff is written
- **AND** Develop SHALL enqueue a `review` job with `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** SHALL NOT enqueue a `quality-gate` job
- **AND** SHALL NOT commit changes, push changes, create pull requests, transition tracker state, or perform workspace terminal cleanup

#### Scenario: Quality Gate failure is returned to Codex
- **WHEN** Codex attempts to stop and Quality Gate exits non-zero or times out before the terminal failed attempt
- **THEN** the Stop hook SHALL return `decision: "block"`
- **AND** the Stop hook SHALL return a bounded `reason` containing the command, status, exit code when available, relevant recent output, and detected failing test names when available
- **AND** Codex SHALL continue in the same session with that reason as continuation context
- **AND** the Stop hook SHALL persist the attempt result and retry counters in run-scoped state
- **AND** the system SHALL keep run-scoped Quality Gate runtime artifacts for diagnostics

#### Scenario: Quality Gate retry budget is exhausted
- **WHEN** Quality Gate has already blocked Codex stop two times and the next Quality Gate attempt exits non-zero or times out
- **THEN** the Stop hook SHALL allow Codex to stop
- **AND** Develop SHALL append a terminal handoff record with `toStage: null`
- **AND** the output SHALL include `development` and `quality`
- **AND** the output SHALL NOT include plan, assessment, review, pull request, tracker synchronization, or stable run context data
- **AND** `quality.status` SHALL be `failed` when the test command exits non-zero
- **AND** `quality.status` SHALL be `timed-out` when the test command exceeds its timeout
- **AND** `quality.outputPath` SHALL be included when a full output artifact exists
- **AND** the system SHALL keep run-scoped Quality Gate runtime artifacts for diagnostics
- **AND** the Develop output status SHALL be `quality-failed` or `quality-timed-out` to distinguish it from successful develop output
- **AND** Develop SHALL NOT enqueue `review`, `make-pr`, or `sync-tracker-state`

#### Scenario: Stop hook avoids recursive blocking
- **WHEN** the Stop hook is invoked while run-scoped hook state indicates an active Quality Gate
- **THEN** the Stop hook SHALL NOT start another Quality Gate command recursively
- **AND** SHALL use the persisted hook state to avoid an unbounded stop-block loop

#### Scenario: Stop hook retries after remediation
- **WHEN** the Stop hook is invoked after a previous Quality Gate failure blocked Codex stop
- **AND** run-scoped hook state is not active
- **THEN** the Stop hook SHALL run the next Quality Gate attempt even when the hook input includes `stop_hook_active`
- **AND** Develop SHALL NOT treat a blocked failed or timed-out Quality Gate attempt as a final Develop result

#### Scenario: Executor fails
- **WHEN** Codex exits with a non-zero code before a Develop handoff is produced
- **THEN** Develop SHALL fail the job
- **WHEN** Codex exceeds the configured Codex executor timeout
- **THEN** Develop SHALL terminate the process and fail the job

#### Scenario: Develop module remains isolated
- **WHEN** Develop behavior is implemented
- **THEN** Develop-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `develop` jobs
