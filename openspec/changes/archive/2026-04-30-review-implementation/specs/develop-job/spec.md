## MODIFIED Requirements

### Requirement: Develop Job Module
The system SHALL provide a `develop` job handled by an isolated Develop module that reads stable run context from the run summary, accepts either a successful Plan handoff for initial work or a failed Review handoff for rework, owns Codex executor invocation and the deterministic Quality Gate Stop-hook loop, and appends formal development and quality output without owning repository or workspace preparation.

#### Scenario: Develop receives planned run data
- **WHEN** a `develop` job runs with a handoff record reference from `plan`
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `develop`
- **AND** Develop SHALL read issue data, configured repository identity, branch name, and workspace path from stable run context in the run summary
- **AND** Develop SHALL read accepted plan data from the referenced Plan handoff record
- **AND** the referenced Plan output SHALL have `status: "success"` and `plan.status: "success"`
- **AND** Develop SHALL NOT require assessment data in its stage input context

#### Scenario: Develop receives Review rework data
- **WHEN** a `develop` job runs with a handoff record reference from `review`
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `develop`
- **AND** Develop SHALL read issue data, configured repository identity, branch name, and workspace path from stable run context in the run summary
- **AND** the referenced Review handoff record SHALL have `toStage: "develop"` and `status: "rework-needed"`
- **AND** the referenced Review output SHALL have `status: "review-failed"` and `review.status: "failed"`
- **AND** Develop SHALL read the review failure text from the referenced Review handoff record
- **AND** Develop SHALL resolve the accepted Plan record from the Review handoff record's explicit dependency ids
- **AND** Develop SHALL NOT receive plan content or review content through queue payload fields

#### Scenario: Develop rejects unsupported input
- **WHEN** a `develop` job runs with an input handoff record that is neither an accepted Plan handoff nor a Review rework handoff
- **THEN** Develop SHALL fail before launching Codex
- **AND** Develop SHALL NOT append a Develop handoff record
- **AND** Develop SHALL NOT enqueue `review`, `make-pr`, or `sync-tracker-state`

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
- **AND** the queued Review job SHALL use the same `stageAttempt` and `reworkAttempt` values as the Develop job that produced the handoff
- **AND** SHALL NOT enqueue a `quality-gate` job
- **AND** SHALL NOT commit changes, push changes, create pull requests, transition tracker state, or perform workspace terminal cleanup

#### Scenario: Rework Develop passes quality
- **WHEN** a Develop job that consumed a Review rework handoff passes Quality Gate
- **THEN** the Develop handoff record to Review SHALL depend on the consumed Review record and the accepted Plan record
- **AND** the Develop handoff record SHALL preserve the same `stageAttempt` and `reworkAttempt` values as the Develop job
- **AND** the queued Review job SHALL preserve the same `stageAttempt` and `reworkAttempt` values as the Develop job

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

### Requirement: Develop prompt template rendering
The Develop module SHALL render its executor prompt from repository-owned Develop prompt templates, using the accepted Plan result content as the plan context for initial work and both the accepted Plan result content and latest Review failure text for review-triggered rework.

#### Scenario: Initial Develop prompt is rendered from repository template
- **WHEN** the Develop module prepares the Codex executor prompt from an accepted Plan handoff
- **THEN** Develop SHALL load a hardcoded repository-owned Develop prompt template
- **AND** render an explicit placeholder for plan content
- **AND** render `PlanOutput.plan.content` as the plan content
- **AND** SHALL NOT add issue number, issue title, or issue description outside the accepted Plan content

#### Scenario: Rework Develop prompt is rendered from repository template
- **WHEN** the Develop module prepares the Codex executor prompt from a Review rework handoff
- **THEN** Develop SHALL load `prompts/develop-rework.md`
- **AND** render the accepted Plan content from the resolved Plan dependency
- **AND** render the Review result content from the consumed Review handoff record
- **AND** SHALL NOT add issue number, issue title, or issue description outside the accepted Plan and Review result content

#### Scenario: Develop executor receives accepted plan text
- **WHEN** Develop launches the configured Codex executor after a successful Plan handoff
- **THEN** the prompt appended to the Codex arguments SHALL contain the accepted Plan content
- **AND** SHALL NOT substitute serialized Plan handoff metadata for the accepted Plan content

#### Scenario: Rework Develop executor receives review context
- **WHEN** Develop launches the configured Codex executor after a Review rework handoff
- **THEN** the prompt appended to the Codex arguments SHALL contain the accepted Plan content
- **AND** SHALL contain the latest Review failure text
- **AND** SHALL NOT substitute serialized Plan or Review handoff metadata for the prompt context

#### Scenario: Development starts a new Codex session
- **WHEN** Develop launches the configured Codex executor after a successful Plan handoff or Review rework handoff
- **THEN** Develop SHALL start a new Codex session for Development
- **AND** SHALL NOT resume or continue the Codex session used by Plan or Review
- **AND** SHALL rely on the accepted Plan content and, for rework, the Review result content from the handoff ledger as the cross-stage context
