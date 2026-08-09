# Task: P1-DOCKER — Docker Configuration for Dev + Production

**Phase**: Phase 1 - Foundation + Plaid Integration  
**Difficulty**: Low-Medium  
**Estimated Time**: 2-3 hours  
**Depends On**: P1-BACKEND + P1-FRONTEND (both ✅)  
**Owner**: [To be assigned]

---

## Overview

Create Docker configuration for local development and production deployment:
- `Dockerfile` — Multi-stage build (backend + frontend)
- `docker-compose.yml` — Local dev environment
- Scripts for building + running

Goal: `docker-compose up` should start the entire app locally.

## Deliverables

1. **`Dockerfile`** — Multi-stage build for production
2. **`docker-compose.yml`** — Local dev environment (already exists, just verify it works)
3. **`frontend/Dockerfile`** — Frontend dev build (optional but nice for consistency)
4. **`.dockerignore`** — Exclude files from build context

## Dockerfile Strategy

Use multi-stage build to:
1. Build backend (TypeScript → JavaScript)
2. Build frontend (React → static files)
3. Runtime stage with only production dependencies

### Stage 1: Builder
- Start from `node:18-alpine`
- Install all dependencies
- Compile backend TypeScript
- Build frontend React app

### Stage 2: Runtime
- Start from `node:18-alpine` (clean slate)
- Copy only built backend + built frontend
- Copy only production dependencies
- No source code, no build tools

### Why Alpine?
- Lightweight (40MB vs 400MB for Ubuntu)
- Includes everything needed for Node
- Fast to pull and start

## Dockerfile

See existing [Dockerfile](../../Dockerfile) in root. Verify it:
- [ ] Uses multi-stage build (builder + runtime)
- [ ] Compiles backend: `npm run build`
- [ ] Builds frontend: `npm run build`
- [ ] Copies built files from builder stage
- [ ] Exposes port 3000
- [ ] Has health check
- [ ] Runs backend as entrypoint (`node backend/dist/server.js`)
- [ ] No secrets in image
- [ ] Can be built: `docker build -t personal-finance-os:latest .`

## docker-compose.yml

See existing [docker-compose.yml](../../docker-compose.yml) in root. Verify it:
- [ ] Has `backend` service
- [ ] Has `frontend` service (or removed if serving from backend)
- [ ] Mounts volumes for development (auto-reload)
- [ ] Sets environment variables from `.env`
- [ ] Backend port: 3000
- [ ] Frontend port: 5173 (Vite default)
- [ ] Health check on backend
- [ ] Networking configured

For dev, we might simplify and just run backend + frontend separately with `npm run dev`. But for consistency, docker-compose should work.

## .dockerignore

Create `.dockerignore` to speed up builds:

```
.git
.gitignore
.env
.env.local
node_modules
npm-debug.log
dist
build
.DS_Store
.vscode
.idea
*.sqlite
*.sqlite3
```

## Testing

```bash
# Build the image
docker build -t personal-finance-os:latest .

# Check image size (should be < 300MB for efficient deployment)
docker images personal-finance-os

# Run locally
docker run -e PLAID_CLIENT_ID=test -e PLAID_SECRET=test \
  -e ANTHROPIC_API_KEY=test \
  -p 3000:3000 personal-finance-os:latest

# In another terminal, test it
curl http://localhost:3000/health
# Should return: { "status": "ok" }

curl http://localhost:3000/api/accounts
# Should return: { "accounts": [...] }

# Stop container
# Ctrl+C in the docker run terminal
```

### With docker-compose (local dev)

```bash
# Start both backend + frontend
docker-compose up

# Wait for both to be ready
# Backend: http://localhost:3000
# Frontend: http://localhost:5173

# In browser, visit http://localhost:5173
# Should see the React dashboard

# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Stop
docker-compose down

# Clean up
docker-compose down -v  # Remove volumes too
```

## Acceptance Criteria

- [ ] `docker build` succeeds with no errors
- [ ] Built image is < 300MB (check with `docker images`)
- [ ] `docker run` starts backend on port 3000
- [ ] `GET /health` returns 200 + status OK
- [ ] `GET /api/accounts` returns valid JSON
- [ ] `docker-compose up` starts backend + frontend
- [ ] Both services healthy (docker-compose ps shows "healthy")
- [ ] Frontend accessible at http://localhost:5173
- [ ] No secrets in final image (check with `docker inspect`)
- [ ] All environment variables come from `.env` file

## Performance Notes

- Multi-stage build keeps image size small
- Alpine Linux is lightweight
- Only production dependencies in runtime (no dev tooling)
- Health check helps orchestration detect failures
- Should startup in < 5 seconds

## Security Notes

- No secrets in `Dockerfile` or image (use env vars at runtime)
- No `--privileged` flag needed
- Run as non-root user (npm already does this)
- `.dockerignore` excludes sensitive files

## Deployment (for Phase 5)

This Dockerfile is designed for production deployment:

```bash
# Build
docker build -t personal-finance-os:latest .

# Push to your registry (if using one)
docker tag personal-finance-os:latest your.registry/personal-finance-os:latest
docker push your.registry/personal-finance-os:latest

# Run on your server
docker run -d \
  -e PLAID_CLIENT_ID=$PLAID_CLIENT_ID \
  -e PLAID_SECRET=$PLAID_SECRET \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -p 3000:3000 \
  --restart always \
  --name pfo \
  personal-finance-os:latest

# Expose via ZTNA / CloudFront (your responsibility)
```

## Notes for Agent

- Keep Dockerfile simple and maintainable
- Multi-stage build is the key optimization (build tools don't go in final image)
- Alpine + Node 18 is stable and widely used
- Health check helps deployment orchestration
- Don't include development dependencies in runtime
- The build will fail gracefully if backend/frontend build steps fail (good for CI/CD)

## Input

- Completed backend from P1-BACKEND task ✅
- Completed frontend from P1-FRONTEND task ✅
- Existing Dockerfile + docker-compose.yml templates

## Output

- Verified Dockerfile that builds working image
- Verified docker-compose.yml for local development
- `.dockerignore` to optimize build
- Working build artifact

## How to Submit

1. Verify existing Dockerfile + docker-compose.yml work
2. Make any corrections needed
3. Create `.dockerignore` file
4. Test build + run locally (follow "Testing" section)
5. Commit: `git add Dockerfile docker-compose.yml .dockerignore`
6. Create PR with test results

---

**Questions?** Check Docker docs or ask in PR.
