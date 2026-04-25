#!/bin/bash
set -eu

# Resolve project root so scripts work regardless of the current shell directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "Error: Docker is not running. Please start Docker and try again."
  exit 1
fi

# Change to the project root to find docker-compose.yml and package.json
cd "$PROJECT_ROOT"

# Load local environment variables when present.
if [ -f "$PROJECT_ROOT/.env.local" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$PROJECT_ROOT/.env.local"
  set +a
  echo "Loaded environment from .env.local"
fi

# Start Redis via docker-compose up -d
echo "Starting Redis..."
docker-compose up -d

# Wait for Redis healthcheck to pass
echo "Waiting for Redis to be healthy..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if docker-compose exec -T redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
    echo "Redis is ready!"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "Waiting for Redis... ($RETRY_COUNT/$MAX_RETRIES)"
  sleep 1
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "Error: Redis healthcheck failed after $MAX_RETRIES attempts"
  docker-compose down
  exit 1
fi

# Cleanup function
cleanup() {
  echo "Shutting down..."
  docker-compose down || echo "Warning: docker-compose down failed"
}

# Trap SIGINT and SIGTERM to cleanup
# NOTE: cleanup only runs on intentional signals (INT/TERM), not on EXIT
# This prevents Redis from being stopped when npm run dev exits unexpectedly
trap cleanup INT TERM

# Start the Node.js server via npm run dev
echo "Starting Node.js server..."
npm run dev
