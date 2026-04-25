## MODIFIED Requirements
### Requirement: Temporary Working Directory
The system SHALL run Codex work in a unique temporary clone and keep successful development work available until Check PR terminalization.

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

#### Scenario: Check PR terminalization completes or fails
- **WHEN** Check PR processing completes or fails after receiving the temporary working directory
- **THEN** Check PR SHALL remove the temporary working directory
- **AND** refuse to delete paths outside `/tmp`
- **AND** refuse to delete symbolic links

### Requirement: Commit Push and Pull Request
The system SHALL commit, push, open a pull request, and hand terminal processing to Check PR from the Make PR job when development produces changes.

#### Scenario: No changes are produced
- **WHEN** Make PR determines that no repository changes were produced after development and review
- **THEN** Make PR SHALL skip commit, push, pull request creation, and label transition
- **AND** enqueue Check PR with the existing issue, branch, and temporary repository path

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
