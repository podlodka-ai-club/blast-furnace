## ADDED Requirements

### Requirement: Plan Human Rework Mode
The Plan module SHALL support planning from human PR rework comments after Prepare Run has prepared a fresh rework workspace.

#### Scenario: Plan receives human rework data
- **WHEN** a `plan` job receives a handoff record reference from rework Prepare Run
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `plan`
- **AND** `stageAttempt` SHALL be `1`
- **AND** Plan SHALL resolve the consumed PR Rework Intake handoff from the Prepare Run handoff dependency chain
- **AND** Plan SHALL resolve the latest available accepted Plan record identified by PR Rework Intake
- **AND** Plan SHALL read task title and task description from stable run context in the run summary

#### Scenario: Rework Plan prompt is rendered from repository template
- **WHEN** Plan runs in human rework mode
- **THEN** Plan SHALL load `prompts/plan-rework.md`
- **AND** render explicit placeholders for task title, task description, latest accepted plan content, and comments markdown
- **AND** use an explicit fallback value when the task description is empty
- **AND** send the rendered prompt as the initial prompt to Codex

#### Scenario: Successful rework Plan is handed off to Develop
- **WHEN** a rework Plan Codex attempt passes deterministic validation
- **THEN** Plan SHALL append a successful Plan handoff record
- **AND** the Plan output SHALL include the accepted rework plan content
- **AND** the Plan handoff SHALL depend on the consumed Prepare Run handoff and the prior latest accepted Plan record
- **AND** Plan SHALL enqueue a `develop` job with `stageAttempt: 1`, the current `reworkAttempt`, and the successful Plan handoff record reference
