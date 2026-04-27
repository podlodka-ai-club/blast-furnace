## REMOVED Requirements

### Requirement: Issue Processor Job
**Reason**: The `issue-processor` job is replaced by the target `prepare-run` stage. Branch naming, branch creation or reuse, branch verification, and scheduling the next stage now belong to Prepare Run.
**Migration**: Use the `prepare-run-job` capability for branch preparation and queue handoff to Assess.

### Requirement: Temporary Working Directory
**Reason**: Temporary workspace creation and repository clone move out of Codex/development processing and into Prepare Run. Terminal cleanup is owned by Make PR for no-change paths and Sync Tracker State for pull-request-created paths.
**Migration**: Use the `prepare-run-job`, `make-pr-job`, and `sync-tracker-state-job` capabilities for workspace preparation and cleanup behavior.

### Requirement: Codex Provider Execution
**Reason**: The `codex-provider` job is replaced by the target `develop` stage, and repository checkout is no longer development responsibility.
**Migration**: Use the `develop-job` capability for Codex executor behavior and the `prepare-run-job` capability for branch checkout/reset behavior.

### Requirement: Commit Push and Pull Request
**Reason**: Commit, push, pull request creation, tracker synchronization, and terminal processing are specified by dedicated target-stage capabilities.
**Migration**: Use the `make-pr-job` capability for commit, push, and pull request creation, and use the `sync-tracker-state-job` capability for post-PR tracker synchronization and terminal cleanup.
