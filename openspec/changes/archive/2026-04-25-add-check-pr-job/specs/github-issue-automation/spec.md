## MODIFIED Requirements
### Requirement: Automated Implementation Attempt
The system SHALL attempt to implement each accepted issue using the configured local Codex CLI executor through the explicit pipeline stages.

#### Scenario: Issue processing begins
- **WHEN** the system starts processing an accepted issue
- **THEN** it SHALL create or reuse an issue branch named from the issue number and title
- **AND** schedule Plan work for that issue branch

#### Scenario: Planning completes
- **WHEN** Plan work completes
- **THEN** the system SHALL schedule Codex execution for the same issue and branch data

#### Scenario: Codex execution begins
- **WHEN** Codex execution starts
- **THEN** the system SHALL clone the target repository into a unique temporary working directory
- **AND** check out the issue branch
- **AND** provide the issue title and body as the task prompt

#### Scenario: Codex makes repository changes
- **WHEN** Codex exits successfully and changes files
- **THEN** the system SHALL schedule Review work for the same issue and branch data plus the temporary repository path
- **AND** SHALL leave commit, push, pull request creation, and label transition to Make PR

#### Scenario: Codex makes no repository changes
- **WHEN** Codex exits successfully without file changes
- **THEN** the system SHALL schedule Review work for the same issue and branch data plus the temporary repository path
- **AND** SHALL leave the no-change finalization decision to Make PR

#### Scenario: Review completes
- **WHEN** Review work completes
- **THEN** the system SHALL schedule Make PR work with the same received data

#### Scenario: Make PR creates a pull request
- **WHEN** Make PR receives reviewed development data with repository changes
- **THEN** the system SHALL commit those changes to the issue branch
- **AND** push the branch to GitHub
- **AND** open a pull request targeting `main`
- **AND** schedule Check PR work with the received temporary repository path

#### Scenario: Make PR finds no changes
- **WHEN** Make PR receives reviewed development data without repository changes
- **THEN** the system SHALL skip commit, push, pull request creation, and label transition
- **AND** schedule Check PR work with the received temporary repository path

#### Scenario: Check PR completes
- **WHEN** Check PR finishes terminal processing
- **THEN** the system SHALL treat the pipeline as complete for that issue

### Requirement: Deterministic Repository Control
The system SHALL keep repository control operations in deterministic orchestrator code rather than delegating them to the agent executor.

#### Scenario: Agent executor runs
- **WHEN** Codex is executing the task prompt
- **THEN** Codex SHALL operate inside the temporary working directory
- **AND** the orchestrator SHALL remain responsible for branch preparation, commit, push, pull request creation, label transition, and terminal cleanup

#### Scenario: Processing completes or fails
- **WHEN** a temporary working directory was created
- **THEN** the system SHALL attempt to clean it up whether the processing outcome succeeds or fails

#### Scenario: Processing cannot complete safely
- **WHEN** branch preparation, Codex execution, commit, push, or pull request creation fails
- **THEN** the system SHALL fail the relevant job instead of fabricating a successful pull request
