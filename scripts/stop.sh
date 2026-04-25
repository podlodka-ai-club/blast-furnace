#!/bin/bash
set -e

# Change to the project root to find docker-compose.yml
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Stop the Node.js server (kill the tsx/node process running the dev server)
echo "Stopping Node.js server..."
if pkill -f "node.*tsx.*src/index.ts" 2>/dev/null; then
  # Wait for the process to actually terminate
  for i in {1..10}; do
    if ! pgrep -f "node.*tsx.*src/index.ts" > /dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
  echo "Node.js server stopped."
else
  echo "No Node.js server process found (may not have been running)."
fi

# Stop Redis via docker-compose down
echo "Stopping Redis..."
docker-compose down

echo "Server and Redis stopped."
