FROM node:20-slim AS base

# Update packages and install build tools
RUN apt-get update && apt-get install -y \
  build-essential \
  python3 \
  libvips-dev \
  git \
  bash \
  ca-certificates \
  curl && \
  rm -rf /var/lib/apt/lists/*

# Set environment for sharp
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1

# --- Builder stage ---
FROM base AS builder

WORKDIR /app
COPY . .

RUN npm install -g turbo@^1.9.3
RUN turbo prune --scope=@documenso/remix --docker

# --- Installer stage ---
FROM base AS installer

WORKDIR /app

# Copy pruned output from builder
COPY --from=builder /app/out/json/ ./
COPY --from=builder /app/out/package-lock.json ./package-lock.json
COPY --from=builder /app/lingui.config.ts ./lingui.config.ts
COPY turbo.json ./

# 🚨 ADD THIS: Copy the full source tree
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages


# Install all dependencies
RUN npm install

# Build everything
RUN npx turbo run build --filter=!@documenso/remix...

# Build remix app
WORKDIR /app/apps/remix

#RUN npx lingui extract && npx lingui compile
RUN ls -la /app/apps/remix/app

RUN npm run build:app
RUN npm run build:server
RUN cp server/main.js build/server/main.js
RUN cp -r ../../packages/lib/translations build/server/hono/packages/lib/translations


# Clean up before shipping
WORKDIR /app
RUN npm prune --omit=dev

# --- Runner stage ---
FROM base AS runner

ENV HUSKY=0
ENV DOCKER_OUTPUT=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

USER nodejs
WORKDIR /app

COPY --from=installer --chown=nodejs:nodejs /app ./

RUN npx prisma generate --schema ./packages/prisma/schema.prisma

COPY --chown=nodejs:nodejs ./docker/start.sh /app/apps/remix/start.sh

WORKDIR /app/apps/remix
CMD ["sh", "start.sh"]
