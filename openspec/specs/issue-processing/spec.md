# Issue Processing Specification

## Purpose
Defines the current issue processing pipeline from queued issue to issue branch, Codex execution, commit, push, pull request creation, and label transition.
## Requirements
### Requirement: Issue Processor Job
The system SHALL turn queued GitHub issues into branch-specific Plan jobs.

#### Scenario: Issue processor receives an issue
- **WHEN** an `issue-processor` job runs
- **THEN** the system SHALL log the issue number, title, and body
- **AND** build a branch name as `issue-{number}-{slugified-title}`

#### Scenario: Title is slugified
- **WHEN** an issue title is converted for a branch name
- **THEN** the slug SHALL be lowercase
- **AND** remove characters other than letters, numbers, spaces, and hyphens
- **AND** replace whitespace with hyphens
- **AND** collapse repeated hyphens
- **AND** truncate to at most 50 characters on a hyphen boundary when possible
- **AND** remove trailing hyphens
- **AND** fall back to `issue` when no slug text remains

#### Scenario: Branch is absent
- **WHEN** the target issue branch does not exist
- **THEN** the processor SHALL read the `main` branch SHA
- **AND** create the target branch from that SHA
- **AND** verify the target branch exists

#### Scenario: Branch already exists
- **WHEN** the target issue branch already exists
- **THEN** the processor SHALL skip branch creation
- **AND** verify the target branch exists

#### Scenario: Plan job is enqueued
- **WHEN** the issue branch is verified
- **THEN** the processor SHALL enqueue a `plan` job
- **AND** include the original issue and branch name

#### Scenario: Verification or enqueue fails
- **WHEN** branch verification or Plan enqueueing fails
- **THEN** the processor SHALL attempt to delete the issue branch
- **AND** rethrow the original error

### Requirement: Temporary Working Directory
The system SHALL run Codex work in a unique temporary clone and keep successful development work available until terminal finalization for the resulting path.

#### Scenario: Temporary directory is created
- **WHEN** a Codex provider job starts
- **THEN** the system SHALL create a unique directory under `/tmp` using the configured prefix and a UUID
- **AND** reject prefixes containing path separators or `..`

#### Scenario: Repository is cloned
- **WHEN** the temporary directory is ready
- **THEN** the system SHALL clone the configured GitHub repository into that directory
- **AND** use an HTTPS remote URL containing the configured GitHub token

#### Scenario: Codex handoff succeeds
- **WHEN** Codex provider execution succeeds and the `review` job is enqueued
- **THEN** the Codex provider SHALL leave the temporary working directory in place for downstream finalization

#### Scenario: Codex handoff does not succeed
- **WHEN** Codex provider execution fails after directory creation or cannot enqueue `review`
- **THEN** the Codex provider SHALL remove the temporary working directory
- **AND** refuse to delete paths outside `/tmp`
- **AND** refuse to delete symbolic links

#### Scenario: Make PR finalizes a no-change outcome
- **WHEN** Make PR determines that no repository changes were produced after development and review
- **THEN** Make PR SHALL remove the temporary working directory
- **AND** refuse to delete paths outside `/tmp`
- **AND** refuse to delete symbolic links

#### Scenario: Check PR terminalization completes or fails
- **WHEN** Check PR processing completes or fails after receiving the temporary working directory from a pull-request-created path
- **THEN** Check PR SHALL remove the temporary working directory
- **AND** refuse to delete paths outside `/tmp`
- **AND** refuse to delete symbolic links

### Requirement: Codex Provider Execution
The system SHALL run Codex CLI against the issue prompt on the issue branch and schedule review after successful development processing without owning repository finalization.

#### Scenario: Branch is checked out
- **WHEN** a Codex provider job runs
- **THEN** it SHALL fetch the issue branch with up to 3 attempts and exponential backoff
- **AND** check out an existing local branch when present
- **AND** reset it hard to `origin/{branchName}`
- **AND** otherwise create a local tracking branch for `origin/{branchName}`

#### Scenario: Codex command is built
- **WHEN** `CODEX_CLI_PATH` is configured as a command with optional arguments
- **THEN** the provider SHALL split it into executable and arguments
- **AND** reject an empty command
- **AND** add `exec` when the command appears to be Codex and no explicit Codex subcommand is present
- **AND** add `--dangerously-bypass-approvals-and-sandbox` when absent
- **AND** append a prompt containing issue number, title, and body

#### Scenario: Codex process runs
- **WHEN** the Codex command is launched
- **THEN** the provider SHALL run it through `node-pty` in the temporary repository directory
- **AND** pass through the current process environment
- **AND** stream non-empty PTY output to the job logger
- **AND** enforce the configured timeout

#### Scenario: Codex process succeeds
- **WHEN** Codex provider processing completes successfully
- **THEN** the provider SHALL enqueue a `review` job
- **AND** forward the received issue and branch data as is to the `review` job
- **AND** include the temporary repository path for downstream finalization
- **AND** SHALL NOT commit changes, push changes, create pull requests, or transition issue labels

#### Scenario: Codex process fails
- **WHEN** Codex exits with a non-zero code
- **THEN** the provider SHALL fail the job
- **WHEN** Codex exceeds the configured timeout
- **THEN** the provider SHALL terminate the process and fail the job

### Requirement: Commit Push and Pull Request
The system SHALL commit, push, open a pull request, and hand post-PR terminal processing to Check PR from the Make PR job when development produces changes.

#### Scenario: No changes are produced
- **WHEN** Make PR determines that no repository changes were produced after development and review
- **THEN** Make PR SHALL skip commit, push, pull request creation, and label transition
- **AND** clean up the existing temporary repository path itself
- **AND** SHALL NOT enqueue Check PR

#### Scenario: Changes are produced
- **WHEN** Make PR determines that repository changes were produced after development and review
- **THEN** Make PR SHALL run `git add -A`
- **AND** commit with message `Processed issue #{number} via codex: {sanitizedTitle}`
- **AND** sanitize the title by removing newlines and limiting it to 200 characters

#### Scenario: Changes are pushed
- **WHEN** a commit is created
- **THEN** Make PR SHALL push the issue branch to the authenticated remote
- **AND** retry push up to 3 attempts with exponential backoff

#### Scenario: Pull request is created
- **WHEN** push succeeds
- **THEN** Make PR SHALL create a pull request
- **AND** use title `Process issue #{number}: {sanitizedTitle}`
- **AND** use the issue branch as head
- **AND** use `main` as base
- **AND** use body `Closes #{number}`
- **AND** enqueue Check PR with the existing issue, branch, temporary repository path, and created pull request result

#### Scenario: Label transition after pull request
- **WHEN** pull request creation succeeds
- **THEN** Make PR SHALL attempt to move the issue labels from `ready` to `in review`
- **AND** log a warning instead of failing the job when label transition fails

#### Scenario: Git or pull request operation fails
- **WHEN** commit, push, or pull request creation fails
- **THEN** Make PR SHALL fail the job

