## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Operator-managed repository selection
**Reason**: Multi-repository workflow is not part of the supported target runtime; repository selection must come from environment configuration only.
**Migration**: Configure the single supported target with `GITHUB_OWNER`, `GITHUB_REPO`, and `GITHUB_TOKEN`.
