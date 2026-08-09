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

echo "✅ Prerequisites checked"
echo ""

# Pull latest code
echo "📦 Pulling latest code from GitHub..."
git pull origin main
echo "✅ Code updated"
echo ""

# Build Docker image
echo "🔨 Building Docker image..."
docker build -t personal-finance-os:latest .
echo "✅ Image built"
echo ""

# Stop old container if running
echo "🛑 Stopping old container (if running)..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
echo "✅ Old container removed"
echo ""

# Start new container
echo "🚀 Starting container..."
docker compose -f "$COMPOSE_FILE" up -d
echo "✅ Container started"
echo ""

# Wait for health check
echo "⏳ Waiting for service to be healthy..."
sleep 5
for i in {1..30}; do
    if docker compose -f "$COMPOSE_FILE" exec -T personal-finance-os wget --quiet --tries=1 --spider http://localhost:3000/health 2>/dev/null; then
        echo "✅ Service is healthy"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Service failed to become healthy"
        docker compose -f "$COMPOSE_FILE" logs
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
