## ADDED Requirements

### Requirement: Develop Human PR Rework Mode
The Develop module SHALL support direct human PR rework input from PR Rework Intake after Prepare Run has prepared a fresh rework workspace.

#### Scenario: Develop receives direct human rework data
- **WHEN** a `develop` job receives a handoff record reference from rework Prepare Run
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `develop`
- **AND** `stageAttempt` SHALL be `1`
- **AND** Develop SHALL resolve the consumed PR Rework Intake handoff from the Prepare Run handoff dependency chain
- **AND** Develop SHALL resolve the latest available accepted Plan record identified by PR Rework Intake
- **AND** Develop SHALL read issue data, repository identity, branch name, and workspace path from the run summary

#### Scenario: Direct human rework Develop prompt is rendered from repository template
- **WHEN** Develop runs from a direct human PR rework handoff
- **THEN** Develop SHALL load `prompts/develop-rework.md`
- **AND** render the latest accepted Plan content from the resolved Plan record
- **AND** render the comments markdown from the PR Rework Intake handoff as `reviewContent`
- **AND** SHALL NOT add issue, repository, branch, or workspace data outside the prompt template placeholders

#### Scenario: Direct human rework Develop passes quality
- **WHEN** direct human rework Develop passes Quality Gate
- **THEN** Develop SHALL append a successful Develop handoff record to Review
- **AND** the handoff record SHALL depend on the consumed Prepare Run handoff, the PR Rework Intake handoff, and the latest accepted Plan record
- **AND** the handoff record SHALL preserve `stageAttempt: 1` and the current `reworkAttempt`
- **AND** Develop SHALL enqueue Review with `stageAttempt: 1`, the current `reworkAttempt`, and the successful Develop handoff record reference

#### Scenario: Unsupported direct Develop input is rejected
- **WHEN** Develop receives a Prepare Run handoff whose dependency chain does not include a valid PR Rework Intake handoff and latest accepted Plan record
- **THEN** Develop SHALL fail before launching Codex
- **AND** Develop SHALL NOT append a Develop handoff record
- **AND** Develop SHALL NOT enqueue Review, Make PR, or Sync Tracker State
