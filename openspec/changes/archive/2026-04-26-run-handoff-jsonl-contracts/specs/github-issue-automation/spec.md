## MODIFIED Requirements

### Requirement: Queue-Driven Pipeline
The system SHALL process automation tasks as discrete asynchronous stages connected through BullMQ transport payloads and run-scoped JSONL handoff records.

#### Scenario: A stage finishes its responsibility
- **WHEN** a pipeline stage has enough information to continue processing
- **THEN** it SHALL append a validated handoff record to the run's JSONL ledger
- **AND** schedule the next stage by adding a new BullMQ job
- **AND** pass only transport metadata and an input handoff record reference through the job payload
- **AND** the payload SHALL include `runId`, `stage`, `stageAttempt`, and `reworkAttempt`

#### Scenario: Worker capacity is unavailable
- **WHEN** the next stage is queued and no worker capacity is immediately available
- **THEN** the work SHALL remain queued until BullMQ can deliver it to a worker

#### Scenario: Stage processing fails transiently
- **WHEN** a stage fails under BullMQ retry policy
- **THEN** the system SHALL allow BullMQ retry handling to re-run the stage according to configured retry behavior
- **AND** SHALL NOT treat BullMQ retry attempts as the domain `stageAttempt`

#### Scenario: Target workflow order is used
- **WHEN** an eligible issue is processed successfully through the full pull-request-created path
- **THEN** the system SHALL process stages in this order: `Intake`, `Prepare Run`, `Assess`, `Plan`, `Develop`, `Quality Gate`, `Review`, `Make PR`, `Sync Tracker State`

### Requirement: Automated Implementation Attempt
The system SHALL attempt to implement each accepted issue using the configured local Codex CLI executor through the target workflow stages, with stage inputs and outputs persisted in the run JSONL ledger.

#### Scenario: Issue processing begins
- **WHEN** the system starts processing an accepted issue
- **THEN** Prepare Run SHALL create a run identity
- **AND** create or reuse an issue branch named from the issue number and title
- **AND** prepare a local repository workspace for the issue branch
- **AND** append the first handoff record containing prepared run context
- **AND** schedule Assess work through the queue with a reference to that handoff record

#### Scenario: Assessment completes
- **WHEN** Assess work completes
- **THEN** the system SHALL append the formal assessment output to the run JSONL ledger
- **AND** schedule Plan work with a reference to the assessment handoff record

#### Scenario: Planning completes
- **WHEN** Plan work completes
- **THEN** the system SHALL append the formal plan output to the run JSONL ledger
- **AND** schedule Develop work with a reference to the plan handoff record

#### Scenario: Development begins
- **WHEN** Develop starts
- **THEN** the system SHALL read the issue, workspace, and plan context from the referenced JSONL handoff record chain
- **AND** run Codex in the prepared repository workspace
- **AND** SHALL NOT clone the repository or check out the issue branch in Develop
- **AND** SHALL provide the issue title, body, and available plan context as the task prompt

#### Scenario: Codex makes repository changes
- **WHEN** Develop exits successfully and changes files
- **THEN** the system SHALL append the formal development output to the run JSONL ledger
- **AND** schedule Quality Gate work with a reference to the development handoff record
- **AND** SHALL leave commit, push, pull request creation, tracker synchronization, and terminal cleanup to later workflow stages

#### Scenario: Codex makes no repository changes
- **WHEN** Develop exits successfully without file changes
- **THEN** the system SHALL append the formal development output to the run JSONL ledger
- **AND** schedule Quality Gate work with a reference to the development handoff record
- **AND** SHALL leave the no-change finalization decision to Make PR

#### Scenario: Quality Gate completes
- **WHEN** Quality Gate work completes
- **THEN** the system SHALL append the formal quality output to the run JSONL ledger
- **AND** schedule Review work with a reference to the quality handoff record

#### Scenario: Review completes
- **WHEN** Review work completes
- **THEN** the system SHALL append the formal review output to the run JSONL ledger
- **AND** schedule Make PR work with a reference to the review handoff record

#### Scenario: Make PR creates a pull request
- **WHEN** Make PR receives reviewed development data through the JSONL ledger and repository changes exist
- **THEN** the system SHALL commit those changes to the issue branch
- **AND** push the branch to GitHub
- **AND** open a pull request targeting `main`
- **AND** append the formal pull request output to the run JSONL ledger
- **AND** schedule Sync Tracker State work with a reference to the pull request handoff record

#### Scenario: Make PR finds no changes
- **WHEN** Make PR receives reviewed development data through the JSONL ledger and no repository changes exist
- **THEN** the system SHALL skip commit, push, pull request creation, and tracker synchronization
- **AND** append a terminal no-change output to the run JSONL ledger
- **AND** clean up the workspace path read from the ledger inside Make PR
- **AND** complete the pipeline without scheduling Sync Tracker State

#### Scenario: Sync Tracker State completes
- **WHEN** Sync Tracker State finishes post-PR tracker synchronization and terminal cleanup
- **THEN** the system SHALL append the formal tracker-sync output to the run JSONL ledger
- **AND** treat the pipeline as complete for that issue

