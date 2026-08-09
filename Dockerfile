# Build stage
FROM node:18-alpine AS builder

# Build backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* backend/pnpm-lock.yaml* ./
RUN npm install
COPY backend ./
RUN echo "=== Files before build ===" && ls -la src/ && echo "=== tsconfig ===" && cat tsconfig.json && echo "=== Running tsc ===" && rm -rf dist tsconfig.tsbuildinfo && npx tsc --version && npx tsc && echo "=== Files after build ===" && ls -la dist/ && echo "=== Compiled server.js ===" && head -20 dist/server.js

# Build frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* frontend/pnpm-lock.yaml* ./
RUN npm install
COPY frontend ./
RUN npm run build

# Runtime stage
FROM node:18-alpine

WORKDIR /app

# Install backend runtime dependencies
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* backend/pnpm-lock.yaml* ./
RUN npm install --production

# Copy built backend
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/package.json ./

# Copy database schema
COPY backend/db ./db

# Copy built frontend (serve from backend)
WORKDIR /app
COPY --from=builder /app/frontend/dist ./backend/public

# Return to app root
WORKDIR /app

# Expose ports
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start backend
CMD ["node", "backend/dist/server.js"]
