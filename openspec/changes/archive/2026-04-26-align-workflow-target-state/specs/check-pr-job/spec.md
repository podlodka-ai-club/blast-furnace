## REMOVED Requirements

### Requirement: Check PR Job Module
**Reason**: The target workflow replaces the `check-pr` terminal stage with `sync-tracker-state`.
**Migration**: Route post-pull-request tracker synchronization and terminal cleanup through the `sync-tracker-state-job` capability.
