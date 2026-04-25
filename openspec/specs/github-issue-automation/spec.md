# GitHub Issue Automation Specification

## Purpose
Defines the product-level behavior of Blast Furnace as an agent orchestrator that turns eligible GitHub Issues into pull requests through an asynchronous, queue-driven pipeline.
## Requirements
### Requirement: Eligible Issue Intake
The system SHALL accept GitHub Issues as automation tasks from configured GitHub repositories.

#### Scenario: Polling discovers eligible issues
- **WHEN** polling intake is enabled
- **THEN** the system SHALL look for open GitHub Issues labeled `ready`
- **AND** treat each matching issue as a task to automate

#### Scenario: Webhook receives a newly opened issue
- **WHEN** webhook intake is enabled
- **AND** GitHub sends a valid `issues.opened` event
- **THEN** the system SHALL treat the issue as a task to automate

#### Scenario: Intake acknowledges work without doing it synchronously
- **WHEN** an eligible issue is received through polling or webhook intake
- **THEN** the system SHALL enqueue processing work for asynchronous execution
- **AND** SHALL NOT require the intake path to complete implementation work before acknowledging receipt or finishing the polling cycle

### Requirement: Queue-Driven Pipeline
The system SHALL process automation tasks as discrete asynchronous stages connected through BullMQ.

#### Scenario: A stage finishes its responsibility
- **WHEN** a pipeline stage has enough information to continue processing
- **THEN** it SHALL schedule the next stage by adding a new BullMQ job
- **AND** pass required stage data through JSON-compatible job payloads

#### Scenario: Worker capacity is unavailable
- **WHEN** the next stage is queued and no worker capacity is immediately available
- **THEN** the work SHALL remain queued until BullMQ can deliver it to a worker

#### Scenario: Stage processing fails transiently
- **WHEN** a stage fails under BullMQ retry policy
- **THEN** the system SHALL allow BullMQ retry handling to re-run the stage according to configured retry behavior

### Requirement: Repository Selection
The system SHALL support automation for one configured repository by default and multiple registered repositories when polling.

#### Scenario: No polling repositories are registered
- **WHEN** polling runs without registered repositories
- **THEN** the system SHALL use the configured `GITHUB_OWNER` and `GITHUB_REPO` as the target repository

#### Scenario: Polling repositories are registered
- **WHEN** one or more repositories are registered for polling
- **THEN** the system SHALL check each registered repository for eligible issues

#### Scenario: Operator manages polling repositories
- **WHEN** an operator uses the repository API or management page
- **THEN** the system SHALL allow repositories to be added, listed, and removed from the polling registry

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
- **AND** clean up the received temporary repository path inside Make PR
- **AND** complete the pipeline without scheduling Check PR

#### Scenario: Check PR completes
- **WHEN** Check PR finishes post-PR terminal processing
- **THEN** the system SHALL treat the pipeline as complete for that issue

### Requirement: Pull Request Outcome
The system SHALL create a GitHub pull request that connects the automated work back to the source issue.

#### Scenario: Pull request is opened
- **WHEN** pushed changes are ready for review
- **THEN** the pull request title SHALL identify the source issue number and title
- **AND** the pull request body SHALL include `Closes #{issueNumber}`
- **AND** the pull request head SHALL be the issue branch
- **AND** the pull request base SHALL be `main`

#### Scenario: Pull request creation succeeds
- **WHEN** the pull request has been created
- **THEN** the system SHALL attempt to move the source issue from `ready` to `in review`

#### Scenario: Label transition fails after PR creation
- **WHEN** the pull request was created but the issue label update fails
- **THEN** the system SHALL keep the pull request result
- **AND** log the label update failure without failing the completed implementation work

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

### Requirement: Operator Readiness
The system SHALL provide basic operational surfaces for running and observing the orchestrator.

#### Scenario: Operator checks service health
- **WHEN** an operator requests the health endpoint
- **THEN** the system SHALL report that the service is running with timestamp and uptime information

#### Scenario: Operator runs local development environment
- **WHEN** an operator starts the project locally using the provided scripts
- **THEN** the system SHALL start Redis and the development server using the documented local workflow

