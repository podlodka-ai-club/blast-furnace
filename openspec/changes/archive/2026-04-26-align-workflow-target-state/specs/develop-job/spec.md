## ADDED Requirements

### Requirement: Develop Job Module
The system SHALL provide a `develop` job handled by an isolated Develop module that owns executor invocation but does not own repository or workspace preparation.

#### Scenario: Develop receives planned run data
- **WHEN** a `develop` job runs
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, issue data, repository identity, branch name, workspace path, and plan data
- **AND** `stage` SHALL be `develop`

#### Scenario: Repository preparation is not repeated
- **WHEN** Develop starts
- **THEN** it SHALL use the workspace path prepared by Prepare Run
- **AND** SHALL NOT create the workspace
- **AND** SHALL NOT clone the repository
- **AND** SHALL NOT create, fetch, check out, or reset the issue branch as repository preparation work

#### Scenario: Codex command is built
- **WHEN** `CODEX_CLI_PATH` is configured as a command with optional arguments
- **THEN** Develop SHALL split it into executable and arguments
- **AND** reject an empty command
- **AND** add `exec` when the command appears to be Codex and no explicit Codex subcommand is present
- **AND** add `--dangerously-bypass-approvals-and-sandbox` when absent
- **AND** append a prompt containing issue number, title, body, and available plan context

#### Scenario: Executor process runs
- **WHEN** the Codex command is launched
- **THEN** Develop SHALL run it through `node-pty` in the prepared workspace
- **AND** pass through the current process environment
- **AND** stream non-empty PTY output to the job logger
- **AND** enforce the configured timeout

#### Scenario: Executor succeeds
- **WHEN** Codex exits successfully
- **THEN** Develop SHALL enqueue a `quality-gate` job
- **AND** pass the run, issue, repository, branch, workspace, plan, development result, `stageAttempt`, and `reworkAttempt` data through the queue payload
- **AND** SHALL NOT commit changes, push changes, create pull requests, transition tracker state, or perform terminal cleanup

#### Scenario: Executor fails
- **WHEN** Codex exits with a non-zero code
- **THEN** Develop SHALL fail the job
- **WHEN** Codex exceeds the configured timeout
- **THEN** Develop SHALL terminate the process and fail the job

#### Scenario: Develop module remains isolated
- **WHEN** Develop behavior is implemented
- **THEN** Develop-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `develop` jobs
