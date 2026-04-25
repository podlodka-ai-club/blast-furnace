# Repository Management Specification

## Purpose
Defines the current Redis-backed repository registry, JSON management API, and lightweight HTML management UI.

## Requirements

### Requirement: Repository Registry Storage
The system SHALL store repositories registered for polling in Redis.

#### Scenario: Repository is added
- **WHEN** a repository owner and name are registered
- **THEN** the system SHALL store a `GitHubRepo` record in Redis set `github:repos`
- **AND** include `owner`, `repo`, and `addedAt`
- **AND** return whether the repository was newly added

#### Scenario: Repository already exists
- **WHEN** the same stored repository member already exists in Redis
- **THEN** the system SHALL report that it was not added

#### Scenario: Repositories are listed
- **WHEN** repositories are listed
- **THEN** the system SHALL return all valid JSON repository records from `github:repos`
- **AND** skip invalid JSON set members

#### Scenario: Repository is removed
- **WHEN** a repository with matching owner and repo exists in `github:repos`
- **THEN** the system SHALL remove that stored member
- **AND** return success
- **WHEN** no matching repository exists
- **THEN** the system SHALL return not found

### Requirement: Repository API
The system SHALL expose JSON API routes for managing repositories.

#### Scenario: List API is requested
- **WHEN** a client requests `GET /repos`
- **THEN** the response SHALL include `repos`
- **AND** include `total` equal to the number of returned repositories

#### Scenario: Add API receives missing or empty fields
- **WHEN** `POST /repos` lacks `owner` or `repo`
- **THEN** the response SHALL have status `400`
- **WHEN** `owner` or `repo` trims to an empty string
- **THEN** the response SHALL have status `400`

#### Scenario: Add API receives invalid format
- **WHEN** `owner` or `repo` contains characters outside letters, numbers, dot, underscore, or hyphen
- **THEN** the response SHALL have status `400`

#### Scenario: Add API receives a new repository
- **WHEN** `POST /repos` receives a valid new owner and repo
- **THEN** the response SHALL have status `201`
- **AND** include the created repository record

#### Scenario: Add API receives a duplicate repository
- **WHEN** `POST /repos` receives a repository already registered
- **THEN** the response SHALL have status `409`

#### Scenario: Delete API removes a repository
- **WHEN** a client requests `DELETE /repos/:owner/:repo` for an existing repository
- **THEN** the response SHALL have status `200`
- **AND** include `{ "success": true }`

#### Scenario: Delete API cannot find a repository
- **WHEN** a client requests `DELETE /repos/:owner/:repo` for an unknown repository
- **THEN** the response SHALL have status `404`

### Requirement: Repository Management UI
The system SHALL expose a lightweight HTML UI for repository polling management.

#### Scenario: UI is requested
- **WHEN** a client requests `GET /repos/manage`
- **THEN** the system SHALL serve an HTML page
- **AND** the page SHALL use `/repos` as the default API base URL

#### Scenario: UI loads repositories
- **WHEN** the page loads in a browser
- **THEN** its JavaScript SHALL request the repository list from the API
- **AND** render registered repositories
- **AND** render an empty state when none exist

#### Scenario: UI manages repositories
- **WHEN** a user submits owner and repo values
- **THEN** the page SHALL call `POST /repos`
- **AND** refresh the list on success
- **WHEN** a user removes a repository
- **THEN** the page SHALL call `DELETE /repos/:owner/:repo`
- **AND** refresh the list on success
