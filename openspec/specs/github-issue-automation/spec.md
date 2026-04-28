# GitHub Issue Automation Specification

## Purpose
Defines the product-level behavior of Blast Furnace as an agent orchestrator that turns eligible GitHub Issues into pull requests through an asynchronous, queue-driven pipeline.
## Requirements
### Requirement: Eligible Issue Intake
The system SHALL accept GitHub Issues as automation tasks only from the configured GitHub repository through polling intake.

#### Scenario: Intake discovers eligible issues
- **WHEN** polling intake runs
- **THEN** the system SHALL look for open GitHub Issues labeled `ready` in the configured repository
- **AND** treat each matching issue as a task to automate

#### Scenario: Intake acknowledges work without doing it synchronously
- **WHEN** an eligible issue is discovered through polling intake
- **THEN** the system SHALL enqueue processing work for asynchronous execution
- **AND** SHALL NOT require the intake path to complete implementation work before finishing the polling cycle

### Requirement: Queue-Driven Pipeline
The system SHALL process automation tasks as discrete asynchronous stages connected through BullMQ transport payloads, stable run context, and run-scoped JSONL handoff records.

#### Scenario: A stage finishes its responsibility
- **WHEN** a pipeline stage has enough information to continue processing
- **THEN** it SHALL append a validated handoff record to the run's JSONL ledger
- **AND** the handoff record output SHALL contain only the output produced by that stage
- **AND** schedule the next stage by adding a new BullMQ job
- **AND** pass only transport metadata and an input handoff record reference through the job payload
- **AND** the payload SHALL include `runId`, `stage`, `stageAttempt`, and `reworkAttempt`
- **AND** the handoff record SHALL NOT persist a `nextInput` copy of the next job payload

#### Scenario: Worker capacity is unavailable
- **WHEN** the next stage is queued and no worker capacity is immediately available
- **THEN** the work SHALL remain queued until BullMQ can deliver it to a worker

#### Scenario: Stage processing fails transiently
- **WHEN** a stage fails under BullMQ retry policy
- **THEN** the system SHALL allow BullMQ retry handling to re-run the stage according to configured retry behavior
- **AND** SHALL NOT treat BullMQ retry attempts as the domain `stageAttempt`

#### Scenario: Target workflow order is used
- **WHEN** an eligible issue is processed successfully through the full pull-request-created path
- **THEN** the system SHALL process stages in this order: `Intake`, `Prepare Run`, `Assess`, `Plan`, `Develop`, `Review`, `Make PR`, `Sync Tracker State`
- **AND** Develop SHALL own Quality Gate execution through the Codex Stop hook rather than scheduling a separate Quality Gate stage

### Requirement: Repository Selection
The system SHALL support automation for exactly one configured repository.

#### Scenario: Intake runs
- **WHEN** intake runs
- **THEN** the system SHALL use `GITHUB_OWNER` and `GITHUB_REPO` as the target repository
- **AND** SHALL NOT read or honor repository registry data from Redis for target selection

#### Scenario: Repository registry entries exist
- **WHEN** Redis contains one or more entries in `github:repos`
- **THEN** the system SHALL ignore those entries for production intake
- **AND** SHALL continue polling only the configured repository

#### Scenario: Downstream stage receives repository identity
- **WHEN** a stage payload includes repository identity
- **THEN** that identity SHALL match the configured repository
- **AND** the stage SHALL NOT use payload repository identity to route GitHub or git operations to another repository

### Requirement: Automated Implementation Attempt
The system SHALL attempt to implement each accepted issue using the configured local Codex CLI executor through the target workflow stages, with stable run context persisted in the run summary and stage-local outputs persisted in the run JSONL ledger.

#### Scenario: Issue processing begins
- **WHEN** the system starts processing an accepted issue
- **THEN** Prepare Run SHALL create a run identity
- **AND** create or reuse an issue branch named from the issue number and title
- **AND** prepare a local repository workspace for the issue branch
- **AND** record stable issue, repository, branch, and workspace context in the run summary
- **AND** append the first stage-local handoff record
- **AND** schedule Assess work through the queue with a reference to that handoff record

#### Scenario: Assessment completes
- **WHEN** Assess work completes
- **THEN** the system SHALL append only the formal assessment output to the run JSONL ledger
- **AND** schedule Plan work with a reference to the assessment handoff record

#### Scenario: Planning completes
- **WHEN** Plan work completes
- **THEN** the system SHALL append only the formal plan output to the run JSONL ledger
- **AND** schedule Develop work with a reference to the plan handoff record

#### Scenario: Development begins
- **WHEN** Develop starts
- **THEN** the system SHALL read issue, repository, branch, and workspace context from the run summary
- **AND** read accepted plan context from the explicit handoff dependency required by Develop
- **AND** run Codex in the prepared repository workspace
- **AND** SHALL NOT clone the repository or check out the issue branch in Develop
- **AND** SHALL provide available plan context as the task prompt

#### Scenario: Codex makes repository changes
- **WHEN** Develop exits successfully and changes files
- **THEN** the system SHALL run Quality Gate through the Develop Stop-hook loop
- **AND** append only formal development and quality output to the run JSONL ledger when Quality Gate passes
- **AND** schedule Review work with a reference to the Develop handoff record
- **AND** SHALL leave commit, push, pull request creation, tracker synchronization, and terminal cleanup to later workflow stages

#### Scenario: Codex makes no repository changes
- **WHEN** Develop exits successfully without file changes
- **THEN** the system SHALL run Quality Gate through the Develop Stop-hook loop
- **AND** append only formal development and quality output to the run JSONL ledger when Quality Gate passes
- **AND** schedule Review work with a reference to the Develop handoff record
- **AND** SHALL leave the no-change finalization decision to Make PR

#### Scenario: Quality Gate passes inside Develop
- **WHEN** Quality Gate passes inside the Develop Stop-hook loop
- **THEN** the Develop handoff output SHALL include `quality.status: "passed"`
- **AND** the handoff SHALL NOT include `quality.outputPath`
- **AND** the handoff output SHALL NOT include plan, assessment, review, pull request, or stable run context data
- **AND** successful run-scoped Quality Gate runtime artifacts SHALL be removed after the Develop handoff is written

#### Scenario: Quality Gate does not pass inside Develop
- **WHEN** Quality Gate is `failed`, `timed-out`, or `misconfigured` after the Develop Stop-hook loop
- **THEN** Develop SHALL append a terminal handoff record to the run JSONL ledger
- **AND** SHALL NOT schedule Review, Make PR, or Sync Tracker State work
- **AND** failed or timed-out run-scoped Quality Gate runtime artifacts SHALL be kept for diagnostics

#### Scenario: Review completes
- **WHEN** Review work completes
- **THEN** the system SHALL append only the formal review output to the run JSONL ledger
- **AND** schedule Make PR work with a reference to the review handoff record

#### Scenario: Make PR creates a pull request
- **WHEN** Make PR receives reviewed development context through explicit handoff dependencies and repository changes exist
- **THEN** the system SHALL commit those changes to the issue branch
- **AND** push the branch to GitHub
- **AND** open a pull request targeting `main`
- **AND** append only the formal pull request output to the run JSONL ledger
- **AND** schedule Sync Tracker State work with a reference to the pull request handoff record

#### Scenario: Make PR finds no changes
- **WHEN** Make PR receives reviewed development context through explicit handoff dependencies and no repository changes exist
- **THEN** the system SHALL skip commit, push, pull request creation, and tracker synchronization
- **AND** append a terminal no-change output to the run JSONL ledger
- **AND** clean up the workspace path read from stable run context inside Make PR
- **AND** complete the pipeline without scheduling Sync Tracker State

#### Scenario: Sync Tracker State completes
- **WHEN** Sync Tracker State finishes post-PR tracker synchronization and terminal cleanup
- **THEN** the system SHALL append only the formal tracker-sync output to the run JSONL ledger
- **AND** treat the pipeline as complete for that issue

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
- **THEN** the system SHALL schedule Sync Tracker State
- **AND** Sync Tracker State SHALL attempt to move the source issue from `ready` to `in review`

#### Scenario: Label transition fails after PR creation
- **WHEN** the pull request was created but the issue label update fails
- **THEN** the system SHALL keep the pull request result
- **AND** log the label update failure without failing the completed implementation work

### Requirement: Deterministic Repository Control
The system SHALL keep repository control operations in deterministic orchestrator code rather than delegating them to the agent executor.

#### Scenario: Agent executor runs
- **WHEN** Codex is executing the task prompt
- **THEN** Codex SHALL operate inside the prepared repository workspace
- **AND** the orchestrator SHALL remain responsible for branch preparation, commit, push, pull request creation, tracker synchronization, and terminal cleanup

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
