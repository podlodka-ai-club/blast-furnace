## REMOVED Requirements

### Requirement: Quality Gate Job Module
**Reason**: Quality evaluation must run inside the Codex Stop-hook loop owned by Develop so failed target-repository unit tests can be returned to Codex in the same active session.

**Migration**: Develop SHALL run Quality Gate through the Stop hook, append `quality` in Develop output, enqueue `review` only after passed quality, and append terminal quality records without scheduling downstream happy-path jobs when quality is failed, timed out, or misconfigured.

#### Scenario: Standalone Quality Gate job is not scheduled
- **WHEN** Develop completes with passed quality
- **THEN** the system SHALL enqueue `review` directly from Develop
- **AND** SHALL NOT enqueue a `quality-gate` job

#### Scenario: Standalone Quality Gate job is not an active worker route
- **WHEN** worker routing receives a job type in the active workflow
- **THEN** `quality-gate` SHALL NOT be treated as a known active workflow job type
