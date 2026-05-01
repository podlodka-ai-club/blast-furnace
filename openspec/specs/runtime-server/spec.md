# Runtime Server Specification

## Purpose
Defines the current application runtime, configuration loading, HTTP server behavior, health endpoint, graceful shutdown, and local Redis development environment.

## Requirements

### Requirement: Environment Configuration
The system SHALL load runtime configuration from environment variables with documented defaults and validation.

#### Scenario: Defaults are used for optional configuration
- **WHEN** optional environment variables are absent
- **THEN** the system SHALL default `NODE_ENV` to `development`
- **AND** default `PORT` to `3000`
- **AND** default `REDIS_HOST` to `localhost`
- **AND** default `REDIS_PORT` to `6379`
- **AND** default `GITHUB_POLL_INTERVAL_MS` to `60000`
- **AND** default `CODEX_CLI_PATH` to `npx @openai/codex`
- **AND** default `CODEX_MODEL` to `gpt-5.4`
- **AND** default `CODEX_TIMEOUT_MS` to `600000`
- **AND** default `QUALITY_GATE_TEST_TIMEOUT_MS` to `180000`
- **AND** leave `QUALITY_GATE_TEST_COMMAND` unset when absent

#### Scenario: Quality Gate command is configured
- **WHEN** `QUALITY_GATE_TEST_COMMAND` is present in the environment
- **THEN** runtime configuration SHALL expose that command to Develop without inferring or modifying it from target repository files
- **AND** Develop SHALL use that command as deterministic deployment configuration for Quality Gate

#### Scenario: Legacy webhook configuration is present
- **WHEN** `GITHUB_ISSUE_STRATEGY` or `GITHUB_WEBHOOK_SECRET` is present in the environment
- **THEN** runtime configuration SHALL NOT expose an issue strategy setting
- **AND** runtime configuration SHALL NOT expose a webhook secret setting
- **AND** startup SHALL continue to use polling intake without a compatibility warning

#### Scenario: Invalid numeric values are rejected
- **WHEN** `PORT` or `REDIS_PORT` is not a valid TCP port
- **THEN** the system SHALL use the configured default value
- **WHEN** `GITHUB_POLL_INTERVAL_MS` is less than `1000` or invalid
- **THEN** the system SHALL use `60000`
- **WHEN** `CODEX_TIMEOUT_MS` is less than `1`, greater than `600000`, or invalid
- **THEN** the system SHALL use `600000`
- **WHEN** `QUALITY_GATE_TEST_TIMEOUT_MS` is less than `1` or invalid
- **THEN** the system SHALL use `180000`

#### Scenario: Startup requires GitHub target configuration
- **WHEN** the application starts without `GITHUB_TOKEN`, `GITHUB_OWNER`, or `GITHUB_REPO`
- **THEN** startup SHALL fail with an error naming the missing variable

#### Scenario: Quality Gate command is absent at startup
- **WHEN** the application starts without `QUALITY_GATE_TEST_COMMAND`
- **THEN** startup SHALL NOT fail solely because the Quality Gate command is absent
- **AND** Develop SHALL later record a `misconfigured` quality result if a run reaches Quality Gate without the command configured

### Requirement: HTTP Server
The system SHALL expose a Fastify HTTP server with CORS and JSON parsing behavior suitable for API routes.

#### Scenario: Server is built
- **WHEN** the server is constructed
- **THEN** it SHALL register CORS using `CORS_ORIGIN`
- **AND** treat `CORS_ORIGIN=*` as allowing all origins
- **AND** split comma-separated origin strings into allowed origins
- **AND** SHALL NOT preserve raw JSON request bytes for webhook signature validation

#### Scenario: Webhook route is requested
- **WHEN** a client requests `POST /webhooks/github`
- **THEN** the server SHALL return its normal missing-route response
- **AND** SHALL NOT enqueue an issue processor job

#### Scenario: Invalid JSON is received
- **WHEN** a request with content type `application/json` contains invalid JSON
- **THEN** the server SHALL reject it with a bad request error

### Requirement: Health Endpoint
The system SHALL expose a health endpoint at `GET /health`.

#### Scenario: Health is requested
- **WHEN** a client requests `GET /health`
- **THEN** the response SHALL include `status: "ok"`
- **AND** include an ISO timestamp
- **AND** include uptime in whole seconds

### Requirement: Graceful Shutdown
The system SHALL shut down server and job infrastructure in a coordinated sequence.

#### Scenario: Shutdown signal is received
- **WHEN** the process receives `SIGINT` or `SIGTERM`
- **THEN** the system SHALL stop accepting HTTP requests
- **AND** close the BullMQ worker if it exists
- **AND** close queue events and the queue
- **AND** close the issue watcher Redis client
- **AND** exit with status `0` when all shutdown steps succeed

#### Scenario: Shutdown fails or times out
- **WHEN** any shutdown step fails
- **THEN** the system SHALL continue attempting later shutdown steps
- **AND** exit with status `1`
- **WHEN** shutdown exceeds 10 seconds
- **THEN** the system SHALL force process exit with status `1`

### Requirement: Local Redis Environment
The project SHALL provide Docker-based Redis support for local development.

#### Scenario: Redis is started through Docker Compose
- **WHEN** Docker Compose starts the local environment
- **THEN** Redis SHALL run from the `redis:7-alpine` image
- **AND** expose `127.0.0.1:6379`
- **AND** provide a healthcheck using `redis-cli ping`

#### Scenario: Development start script is used
- **WHEN** `./scripts/start.sh` is run
- **THEN** the script SHALL check Docker availability
- **AND** start Redis through Docker Compose
- **AND** wait for Redis health
- **AND** start the development server with `npm run dev`
