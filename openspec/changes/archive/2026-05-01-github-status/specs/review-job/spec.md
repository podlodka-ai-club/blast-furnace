## ADDED Requirements

### Requirement: Review Status Reporting
The Review flow SHALL report Review progress, retryable rework, and terminal Review outcomes through the shared tracker status model.

#### Scenario: Review starts
- **WHEN** a Review job starts
- **THEN** the Review flow SHALL update the matching `review:attempt-N` status item to `in-progress`

#### Scenario: Review succeeds
- **WHEN** Review appends a successful output and enqueues Make PR
- **THEN** the Review flow SHALL update the matching Review status item to `completed`
- **AND** SHALL update the combined Draft PR / move issue to `in review` item to `pending`

#### Scenario: Review requests rework with retry budget
- **WHEN** Review appends a `rework-needed` output and enqueues Develop
- **THEN** the Review flow SHALL update the current Review status item to `retrying`
- **AND** SHALL upsert the next Develop, Quality Gate, and Review rework status items with deterministic attempt-aware ids
- **AND** SHALL render the rework history in the separate Review feedback loop table
- **AND** SHALL include a Review-column status icon showing that changes were requested

#### Scenario: Review exhausts retry budget
- **WHEN** Review appends a terminal exhausted output
- **THEN** the Review flow SHALL update the current Review status item to `failed`
- **AND** SHALL mark the combined Draft PR / move issue to `in review` item as `skipped`
- **AND** SHALL render the terminal Review attempt in the Review feedback loop table with a terminal failure icon

#### Scenario: Review malformed response terminates
- **WHEN** Review appends a terminal malformed output
- **THEN** the Review flow SHALL update the current Review status item to `failed`
- **AND** SHALL mark the combined Draft PR / move issue to `in review` item as `skipped`
- **AND** SHALL NOT enqueue Develop or Make PR
