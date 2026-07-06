# Synthr Cyber x402 - Dockerfile
# VPS-friendly Bun runtime with healthcheck support.

FROM oven/bun:1.2-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json* bun.lockb* ./
RUN if [ -f bun.lockb ]; then bun install --frozen-lockfile --production; else bun install --production; fi

# Build stage (for TS if needed, Bun runs TS natively)
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Production runtime
FROM oven/bun:1.2-slim AS runner
WORKDIR /app

# Copy built artifacts
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./

# Non-root user for security
USER bun

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "src/index.ts"]
