## MODIFIED Requirements

### Requirement: Eligible Issue Intake
The system SHALL accept GitHub Issues as automation tasks from configured GitHub repositories through polling intake.

#### Scenario: Intake discovers eligible issues
- **WHEN** polling intake runs
- **THEN** the system SHALL look for open GitHub Issues labeled `ready`
- **AND** treat each matching issue as a task to automate

#### Scenario: Intake acknowledges work without doing it synchronously
- **WHEN** an eligible issue is discovered through polling intake
- **THEN** the system SHALL enqueue processing work for asynchronous execution
- **AND** SHALL NOT require the intake path to complete implementation work before finishing the polling cycle

### Requirement: Repository Selection
The system SHALL support automation for one configured repository by default and multiple registered repositories through polling intake.

#### Scenario: No repositories are registered
- **WHEN** intake runs without registered repositories
- **THEN** the system SHALL use the configured `GITHUB_OWNER` and `GITHUB_REPO` as the target repository

#### Scenario: Repositories are registered
- **WHEN** one or more repositories are registered for intake
- **THEN** the system SHALL check each registered repository for eligible issues

#### Scenario: Operator manages intake repositories
- **WHEN** an operator uses the repository API or management page
- **THEN** the system SHALL allow repositories to be added, listed, and removed from the polling registry
