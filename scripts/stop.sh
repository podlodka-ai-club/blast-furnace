#!/bin/bash
set -e

# Change to the script's directory to find docker-compose.yml
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Stop the Node.js server (kill the tsx/node process running the dev server)
echo "Stopping Node.js server..."
if pkill -f "tsx.*src/index.ts" 2>/dev/null; then
  echo "Node.js server stopped."
else
  echo "No Node.js server process found (may not have been running)."
fi

# Give the server a moment to shut down gracefully
sleep 1

# Stop Redis via docker-compose down
echo "Stopping Redis..."
docker-compose down

echo "Server and Redis stopped."