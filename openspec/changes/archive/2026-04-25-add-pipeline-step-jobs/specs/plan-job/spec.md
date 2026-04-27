## ADDED Requirements

### Requirement: Plan Job Module
The system SHALL provide a `plan` job handled by an isolated Plan module.

#### Scenario: Plan job receives assessed issue data
- **WHEN** a `plan` job runs with issue and branch data from `issue-processor`
- **THEN** the Plan module SHALL enqueue a `codex-provider` job
- **AND** forward the received issue and branch data as is to the `codex-provider` job
- **AND** leave development, review, and pull request work to later pipeline jobs

#### Scenario: Plan module remains isolated
- **WHEN** Plan behavior is implemented
- **THEN** Plan-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `plan` jobs
