# review-job Specification

## Purpose
TBD - created by archiving change add-pipeline-step-jobs. Update Purpose after archive.
## Requirements
### Requirement: Review Job Module
The system SHALL provide a `review` job handled by an isolated Review module.

#### Scenario: Review job receives development data
- **WHEN** a `review` job runs with issue, branch, and temporary repository path data from `codex-provider`
- **THEN** the Review module SHALL enqueue a `make-pr` job
- **AND** forward the received data as is to the `make-pr` job
- **AND** leave pull request work to the Make PR job

#### Scenario: Review module remains isolated
- **WHEN** Review behavior is implemented
- **THEN** Review-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `review` jobs

