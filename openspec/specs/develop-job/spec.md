# develop-job Specification

## Purpose
Defines the target Develop stage that invokes the configured Codex executor inside the prepared workspace and owns deterministic Quality Gate execution through the Codex Stop hook.
## Requirements
### Requirement: Develop Job Module
The system SHALL provide a `develop` job handled by an isolated Develop module that reads planned input from the JSONL ledger, owns Codex executor invocation and the deterministic Quality Gate Stop-hook loop, and appends formal development and quality output without owning repository or workspace preparation.

#### Scenario: Develop receives planned run data
- **WHEN** a `develop` job runs
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `develop`
- **AND** Develop SHALL read issue data, repository identity, branch name, workspace path, assessment data, and plan data from the referenced JSONL record chain

#### Scenario: Repository preparation is not repeated
- **WHEN** Develop starts
- **THEN** it SHALL use the workspace path read from the JSONL ledger and prepared by Prepare Run
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
- **AND** append a prompt containing issue number, title, body, and available plan context

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

#### Scenario: Quality Gate passes
- **WHEN** Codex attempts to stop and Quality Gate exits with code `0`
- **THEN** the Stop hook SHALL allow Codex to stop
- **AND** Develop SHALL append a handoff record from `develop` to `review`
- **AND** the output SHALL include `development` and `quality`
- **AND** `quality.status` SHALL be `passed`
- **AND** `quality` SHALL include `command`, `exitCode`, `attempts`, `durationMs`, `summary`, and optional `outputPath`
- **AND** Develop SHALL enqueue a `review` job with `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** SHALL NOT enqueue a `quality-gate` job
- **AND** SHALL NOT commit changes, push changes, create pull requests, transition tracker state, or perform terminal cleanup

#### Scenario: Quality Gate failure is returned to Codex
- **WHEN** Codex attempts to stop and Quality Gate exits non-zero or times out before the terminal failed attempt
- **THEN** the Stop hook SHALL return `decision: "block"`
- **AND** the Stop hook SHALL return a bounded `reason` containing the command, status, exit code when available, relevant recent output, and detected failing test names when available
- **AND** Codex SHALL continue in the same session with that reason as continuation context
- **AND** the Stop hook SHALL persist the attempt result and retry counters in run-scoped state

#### Scenario: Quality Gate retry budget is exhausted
- **WHEN** Quality Gate has already blocked Codex stop two times and the next Quality Gate attempt exits non-zero or times out
- **THEN** the Stop hook SHALL allow Codex to stop
- **AND** Develop SHALL append a terminal handoff record with `toStage: null`
- **AND** the output SHALL include `development` and `quality`
- **AND** `quality.status` SHALL be `failed` when the test command exits non-zero
- **AND** `quality.status` SHALL be `timed-out` when the test command exceeds its timeout
- **AND** the Develop output status SHALL be `quality-failed` or `quality-timed-out` to distinguish it from successful develop output
- **AND** Develop SHALL NOT enqueue `review`, `make-pr`, or `sync-tracker-state`

#### Scenario: Stop hook avoids recursive blocking
- **WHEN** the Stop hook is invoked while run-scoped hook state or the hook input indicates `stop_hook_active`
- **THEN** the Stop hook SHALL NOT start another Quality Gate command recursively
- **AND** SHALL use the persisted hook state to avoid an unbounded stop-block loop

#### Scenario: Executor fails
- **WHEN** Codex exits with a non-zero code before a Develop handoff is produced
- **THEN** Develop SHALL fail the job
- **WHEN** Codex exceeds the configured Codex executor timeout
- **THEN** Develop SHALL terminate the process and fail the job

#### Scenario: Develop module remains isolated
- **WHEN** Develop behavior is implemented
- **THEN** Develop-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `develop` jobs

### Requirement: Develop prompt template rendering
The Develop module SHALL render its executor prompt from a repository-owned Develop prompt template and SHALL use the accepted Plan result content as the plan context.

#### Scenario: Develop prompt is rendered from repository template
- **WHEN** the Develop module prepares the Codex executor prompt
- **THEN** Develop SHALL load a hardcoded repository-owned Develop prompt template
- **AND** render an explicit placeholder for plan content
- **AND** render `PlanOutput.plan.content` as the plan content
- **AND** SHALL NOT add issue number, issue title, or issue description outside the accepted Plan content

#### Scenario: Develop executor receives accepted plan text
- **WHEN** Develop launches the configured Codex executor after a successful Plan handoff
- **THEN** the prompt appended to the Codex arguments SHALL contain the accepted Plan content
- **AND** SHALL NOT substitute serialized Plan handoff metadata for the accepted Plan content

#### Scenario: Development starts a new Codex session
- **WHEN** Develop launches the configured Codex executor after a successful Plan handoff
- **THEN** Develop SHALL start a new Codex session for Development
- **AND** SHALL NOT resume or continue the Codex session used by Plan
- **AND** SHALL rely on the accepted Plan content from the handoff ledger as the cross-stage context

