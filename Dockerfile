# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm install

# Copy source code
COPY backend ./backend
COPY frontend ./frontend

# Build backend
WORKDIR /app/backend
RUN npm run build

# Build frontend
WORKDIR /app/frontend
RUN npm run build

# Runtime stage
FROM node:18-alpine

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm install --production

# Copy built backend
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/package.json ./backend/

# Copy built frontend
COPY --from=builder /app/frontend/dist ./frontend/dist

# Copy database schema
COPY backend/db ./backend/db

# Expose ports
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start backend (which also serves frontend)
CMD ["node", "backend/dist/server.js"]
