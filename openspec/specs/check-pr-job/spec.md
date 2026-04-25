# check-pr-job Specification

## Purpose
TBD - created by archiving change add-check-pr-job. Update Purpose after archive.
## Requirements
### Requirement: Check PR Job Module
The system SHALL provide a `check-pr` job handled by an isolated Check PR module that owns terminal post-Make-PR handling only for paths where a pull request was created.

#### Scenario: Check PR receives Make PR output with a pull request
- **WHEN** a `check-pr` job runs with data from `make-pr` after pull request creation
- **THEN** the Check PR module SHALL preserve the received issue and branch data as is
- **AND** use the received temporary repository path as the terminal repository workspace for that issue
- **AND** keep the received pull request result available to the job logic

#### Scenario: Temporary repository is cleaned up
- **WHEN** Check PR completes or fails after receiving a temporary repository path from a pull-request-created path
- **THEN** it SHALL attempt to clean up that temporary repository path

#### Scenario: Check PR module remains isolated
- **WHEN** Check PR behavior is implemented
- **THEN** Check PR-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `check-pr` jobs

