#!/bin/sh
set -e

# Configuration
REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"
MONGO_HOST="${MONGO_HOST:-mongo}"
MONGO_PORT="${MONGO_PORT:-27017}"
MAX_WAIT_TIME="${MAX_WAIT_TIME:-120}"
RETRY_INTERVAL="${RETRY_INTERVAL:-2}"

# Function to wait for a service
wait_for_service() {
    local service_name=$1
    local host=$2
    local port=$3
    local elapsed=0

    echo "Waiting for ${service_name} at ${host}:${port}..."

    while [ $elapsed -lt $MAX_WAIT_TIME ]; do
        if nc -z "$host" "$port" 2>/dev/null; then
            echo "${service_name} is ready!"
            return 0
        fi

        sleep $RETRY_INTERVAL
        elapsed=$((elapsed + RETRY_INTERVAL))

        if [ $((elapsed % 10)) -eq 0 ]; then
            echo "Still waiting for ${service_name}... (${elapsed}s elapsed)"
        fi
    done

    echo "ERROR: ${service_name} at ${host}:${port} did not become available within ${MAX_WAIT_TIME} seconds" >&2
    echo "This may indicate:" >&2
    echo "  - The service is not running" >&2
    echo "  - Network connectivity issues" >&2
    echo "  - The hostname '${host}' cannot be resolved" >&2
    exit 1
}

# Wait for Redis
wait_for_service "Redis" "$REDIS_HOST" "$REDIS_PORT"

# Wait for MongoDB
wait_for_service "MongoDB" "$MONGO_HOST" "$MONGO_PORT"

echo "All services ready. Starting app..."
exec "$@"
