#!/bin/bash
# Personal Finance OS — Deployment Script for hermes
# Run this on hermes after setting up .env.production

set -e

REPO_DIR="$HOME/personal-finance-os"
ENV_FILE="$REPO_DIR/.env.production"
COMPOSE_FILE="$REPO_DIR/docker-compose.prod.yml"

echo "=========================================="
echo "Personal Finance OS — Deployment to hermes"
echo "=========================================="
echo ""

# Check prerequisites
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Error: $ENV_FILE not found"
    echo "Please create .env.production with your secrets first"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed"
    exit 1
fi

cd "$REPO_DIR"

# Preserve the selected local gateway integration on later deployments.
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--gateway" ]; }; then
    echo "Usage: $0 [--gateway]" >&2
    exit 2
fi
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
CURRENT_FILES=$(docker inspect personal-finance-os --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' 2>/dev/null || true)
if [ "${1:-}" = "--gateway" ] || [[ "$CURRENT_FILES" == *docker-compose.gateway.yml* ]]; then
    COMPOSE+=(-f "$REPO_DIR/docker-compose.gateway.yml")
fi

echo "✅ Prerequisites checked"
echo ""

# Pull latest code
echo "📦 Pulling latest code from GitHub..."
git pull origin main
echo "✅ Code updated"
echo ""

# Build Docker image
echo "🔨 Building Docker image..."
"${COMPOSE[@]}" build personal-finance-os
echo "✅ Image built"
echo ""

# Recreate only the application, preserving volumes and the scoped Docker network.
echo "Starting the selected configuration..."
"${COMPOSE[@]}" up -d --no-build --no-deps --force-recreate personal-finance-os
echo "Service started"
echo ""

# Wait for health check
echo "⏳ Waiting for service to be healthy..."
sleep 5
for i in {1..30}; do
    if "${COMPOSE[@]}" exec -T personal-finance-os wget --quiet --tries=1 --spider http://localhost:3000/health 2>/dev/null; then
        echo "✅ Service is healthy"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Service failed to become healthy"
        "${COMPOSE[@]}" logs --tail 50
        exit 1
    fi
    echo "  Attempt $i/30..."
    sleep 1
done

echo ""
echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "Service is running on: http://hermes:8080"
echo ""
echo "Next steps:"
echo "1. In CloudFront/ZTNA, add HTTPS port pointing to hermes:8080"
echo "2. Visit: https://finance.your-domain.com (once ZTNA is configured)"
echo ""
echo "Monitor logs:"
echo "  docker compose -f $COMPOSE_FILE logs -f"
echo ""
echo "Stop service:"
echo "  docker compose -f $COMPOSE_FILE down"
echo ""
