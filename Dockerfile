# --- Base Stage ---
FROM node:20-slim AS base

# Update and install system dependencies
RUN apt-get update && apt-get install -y \
  build-essential \
  python3 \
  libvips-dev \
  git \
  bash \
  ca-certificates \
  curl && \
  rm -rf /var/lib/apt/lists/*

# Prevent Sharp from relying on global libvips
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1

# --- Builder Stage ---
FROM base AS builder

WORKDIR /app

# Copy full source into builder
COPY . .

# Install turbo globally
RUN npm install -g turbo@^1.9.3

# Prune to isolate @documenso/remix and dependencies
RUN turbo prune --scope=@documenso/remix --docker

# --- Installer Stage ---
FROM base AS installer

WORKDIR /app

# Copy Turbo pruned output + lockfiles
COPY --from=builder /app/out/json/ ./
COPY --from=builder /app/out/package-lock.json ./package-lock.json
COPY --from=builder /app/lingui.config.ts ./lingui.config.ts
COPY --from=builder /app/turbo.json ./turbo.json

# ✅ Add the actual app code and shared packages
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages

# Optional debug check
RUN ls -la /app/apps/remix/app

# Install dependencies
RUN npm install

# Build all packages except remix
RUN npx turbo run build --filter=!@documenso/remix...

# Build the remix app
WORKDIR /app/apps/remix

# Optional: install env utilities (if needed)
RUN npm install -g dotenv-cli

# Build steps
RUN npm run build:app
RUN npm run build:server

# Move built server code into correct structure
RUN cp server/main.js build/server/main.js
RUN cp -r ../../packages/lib/translations build/server/hono/packages/lib/translations

# Clean up dev dependencies
WORKDIR /app
RUN npm prune --omit=dev

# --- Runner Stage ---
FROM base AS runner

# Environment flags
ENV HUSKY=0
ENV DOCKER_OUTPUT=1

# ✅ Install bash (while still root)
RUN apt-get update && apt-get install -y bash && rm -rf /var/lib/apt/lists/*

# Create a secure non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

WORKDIR /app

# Copy built app from installer
COPY --from=installer /app ./

# Generate Prisma client (optional: if not pre-generated)
RUN npx prisma generate --schema ./packages/prisma/schema.prisma

# Copy the start script and make it executable
COPY --chown=nodejs:nodejs ./docker/start.sh /start.sh
RUN chmod +x /start.sh

# Use non-root user from here on
USER nodejs

# Set working directory to remix app
WORKDIR /app/apps/remix

RUN ls -la /app/apps/remix/build/server
RUN ls -la /app/packages/prisma/schema.prisma

# Start the app
CMD ["bash", "/start.sh"]
