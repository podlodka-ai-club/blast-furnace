## ADDED Requirements

### Requirement: Develop Status Reporting
The Develop flow SHALL report development and deterministic Quality Gate progress through the shared tracker status model.

#### Scenario: Initial Develop starts
- **WHEN** a Develop job starts from an accepted Plan handoff
- **THEN** the Develop flow SHALL update the status item `develop:attempt-1` to `in-progress`
- **AND** SHALL leave `quality-gate:attempt-1` as `pending` until the quality result is being evaluated or known

#### Scenario: Rework Develop starts
- **WHEN** a Develop job starts from a Review rework handoff
- **THEN** the Develop flow SHALL upsert the matching rework status items for `develop:attempt-N`, `quality-gate:attempt-N`, and `review:attempt-N`
- **AND** SHALL update `develop:attempt-N` to `in-progress`
- **AND** SHALL NOT create duplicate checklist rows when the same update is retried

#### Scenario: Develop hands off to Review after passed Quality Gate
- **WHEN** Develop produces a successful handoff with `quality.status: "passed"`
- **THEN** the Develop flow SHALL update the matching Develop status item to `completed`
- **AND** SHALL update the matching Quality Gate status item to `completed`
- **AND** SHALL leave the matching Review status item as `pending` until Review starts

#### Scenario: Develop terminates on Quality Gate failure
- **WHEN** Develop terminates with `quality.status` of `failed`, `timed-out`, or `misconfigured`
- **THEN** the Develop flow SHALL update the matching Develop status item to `failed`
- **AND** SHALL update the matching Quality Gate status item to `failed`
- **AND** SHALL mark downstream visible items as `skipped`
- **AND** SHALL NOT mark retryable Review failures as Develop failures
