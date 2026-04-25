# Docker Redis Environment

This project uses Docker Compose to run Redis locally, eliminating the need to install Redis directly on your machine.

## Docker Compose Commands

Start Redis in the background:
```bash
docker-compose up -d
```

Check Redis status:
```bash
docker-compose ps
```

View Redis logs:
```bash
docker-compose logs redis
```

Stop Redis:
```bash
docker-compose down
```

Stop Redis and remove data volumes:
```bash
docker-compose down -v
```

## Start/Stop Scripts

Instead of running docker-compose commands manually, you can use the provided scripts that handle both Redis and the Node.js server.

Start the server with Redis:
```bash
./scripts/start.sh
```

Stop the server and Redis:
```bash
./scripts/stop.sh
```

The start script:
1. Checks that Docker is running
2. Starts Redis via docker-compose
3. Waits for Redis to be healthy
4. Starts the Node.js server via `npm run dev`

The stop script:
1. Stops the Node.js server (tsx process)
2. Stops Redis via docker-compose down

## Requirements

- Docker must be installed on your machine
- Docker Compose must be available

For installation instructions, visit https://docs.docker.com/get-docker/