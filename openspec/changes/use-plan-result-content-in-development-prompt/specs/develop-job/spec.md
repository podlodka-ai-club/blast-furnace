## ADDED Requirements

### Requirement: Develop prompt template rendering
The Develop module SHALL render its executor prompt from a repository-owned Develop prompt template and SHALL use the accepted Plan result content as the plan context.

#### Scenario: Develop prompt is rendered from repository template
- **WHEN** the Develop module prepares the Codex executor prompt
- **THEN** Develop SHALL load a hardcoded repository-owned Develop prompt template
- **AND** render an explicit placeholder for plan content
- **AND** render `PlanOutput.plan.content` as the plan content
- **AND** SHALL NOT add issue number, issue title, or issue description outside the accepted Plan content

#### Scenario: Develop executor receives accepted plan text
- **WHEN** Develop launches the configured Codex executor after a successful Plan handoff
- **THEN** the prompt appended to the Codex arguments SHALL contain the accepted Plan content
- **AND** SHALL NOT substitute serialized Plan handoff metadata for the accepted Plan content

#### Scenario: Development starts a new Codex session
- **WHEN** Develop launches the configured Codex executor after a successful Plan handoff
- **THEN** Develop SHALL start a new Codex session for Development
- **AND** SHALL NOT resume or continue the Codex session used by Plan
- **AND** SHALL rely on the accepted Plan content from the handoff ledger as the cross-stage context
