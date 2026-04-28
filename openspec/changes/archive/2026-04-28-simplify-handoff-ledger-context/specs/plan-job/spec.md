## MODIFIED Requirements

### Requirement: Plan Job Module
The system SHALL provide a `plan` job handled by an isolated Plan module in the target workflow that reads stable run context from the run summary, reads assessment output from the JSONL ledger, generates and validates Codex-backed plan output, records each planning attempt in the ledger, and only hands off successful accepted plan content to Develop.

#### Scenario: Plan job receives assessed run data
- **WHEN** a `plan` job runs with a handoff record reference from `assess`
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `plan`
- **AND** Plan SHALL read issue data, repository identity, branch name, and workspace path from stable run context in the run summary
- **AND** Plan SHALL read assessment data from the referenced Assess handoff record

#### Scenario: Initial Plan prompt is rendered from repository template
- **WHEN** the Plan module begins a planning run
- **THEN** Plan SHALL load a hardcoded repository-owned Plan prompt template
- **AND** render explicit placeholders for assessed issue number, issue title, and issue description
- **AND** use an explicit fallback value when the issue description is empty
- **AND** send the rendered prompt as the initial prompt to Codex

#### Scenario: Plan invokes Codex in an isolated planning session
- **WHEN** Plan generates planning output
- **THEN** the Plan module SHALL launch Codex using the configured Codex command conventions
- **AND** all Plan revision attempts for the job SHALL occur in the same Codex process or session
- **AND** Plan SHALL NOT pass live Codex session state across the stage boundary

#### Scenario: Plan validates required response titles from YAML
- **WHEN** Codex returns a planning response
- **THEN** Plan SHALL load required response titles from a hardcoded YAML checks file
- **AND** validate the YAML file with a strict schema before applying checks
- **AND** treat a required title as present when the response contains a Markdown heading whose text matches the required title case-insensitively after trimming heading markers and whitespace
- **AND** mark validation failed when any required title is missing

#### Scenario: Failed validation attempt is recorded before retry limit
- **WHEN** a Plan Codex attempt fails deterministic validation and fewer than three total Codex attempts have been made
- **THEN** the Plan module SHALL append a non-terminal Plan handoff record to the JSONL ledger
- **AND** the handoff record output SHALL include the unsuccessful plan content and a human-readable validation failure reason
- **AND** the handoff record output SHALL NOT include assessment data or stable run context data
- **AND** the handoff record SHALL indicate that Plan rework is needed and that control remains with Plan
- **AND** Plan SHALL continue by sending a hardcoded continuation prompt into the same Plan Codex session

#### Scenario: Third failed validation attempt is terminal
- **WHEN** the third consecutive Plan Codex attempt fails deterministic validation
- **THEN** the Plan module SHALL append a terminal non-urgent Plan handoff record to the JSONL ledger
- **AND** the handoff record output SHALL include the unsuccessful plan content and a human-readable validation failure reason
- **AND** the handoff record output SHALL NOT include assessment data or stable run context data
- **AND** the handoff record SHALL indicate that the workflow is blocked without a downstream stage
- **AND** Plan SHALL NOT enqueue a `develop` job

#### Scenario: Successful validated plan is handed off to Develop
- **WHEN** a Plan Codex attempt passes deterministic validation
- **THEN** the Plan module SHALL append a successful Plan handoff record to the JSONL ledger
- **AND** the Plan output SHALL include the accepted plan content
- **AND** the Plan output SHALL indicate a successful plan status
- **AND** the Plan output SHALL NOT include assessment, development, quality, review, pull request, tracker synchronization, or stable run context data
- **AND** the Plan module SHALL enqueue a `develop` job
- **AND** the Develop queue payload SHALL pass `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and the successful Plan handoff record reference

#### Scenario: Plan attempt handoff records are chained
- **WHEN** Plan records multiple Codex attempts for one job
- **THEN** each Plan attempt handoff record SHALL depend on the previous relevant input or Plan attempt record
- **AND** the ledger chain SHALL preserve the order of attempted Plan responses and validation outcomes
- **AND** the dependency chain SHALL use handoff record ids rather than copying previous output data

#### Scenario: Future comment side effect is reserved
- **WHEN** Plan behavior is expanded later
- **THEN** the Plan module SHALL be the place for a future GitHub planning comment side effect
- **AND** this change SHALL NOT require that side effect to be implemented

#### Scenario: Plan module remains isolated
- **WHEN** Plan behavior is implemented
- **THEN** Plan-specific code SHALL live in its own job module or Plan-owned helpers
- **AND** worker routing SHALL call that module for `plan` jobs
