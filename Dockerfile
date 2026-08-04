# syntax=docker/dockerfile:1
FROM node:22-slim

# Install system dependencies — cache the apt layer across builds
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y \
      build-essential \
      python3 \
      libvips-dev \
      git \
      dos2unix \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV HUSKY=0
ENV DOCKER_OUTPUT=1
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
ENV SHARP_FORCE_GLOBAL_LIBVIPS=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# ── Layer-cache strategy ──────────────────────────────────────────────────────
# Copy manifests ONLY first so that npm ci and playwright install are cached
# across code-only changes. The full source is copied after the installs.

# Root manifests
COPY package*.json turbo.json lingui.config.ts ./

# Workspace package.json files (no source yet)
COPY apps/documentation/package.json  apps/documentation/
COPY apps/openpage-api/package.json   apps/openpage-api/
COPY apps/remix/package.json          apps/remix/
COPY packages/api/package.json        packages/api/
COPY packages/app-tests/package.json  packages/app-tests/
COPY packages/assets/package.json     packages/assets/
COPY packages/auth/package.json       packages/auth/
COPY packages/ee/package.json         packages/ee/
COPY packages/email/package.json      packages/email/
COPY packages/eslint-config/package.json  packages/eslint-config/
COPY packages/lib/package.json        packages/lib/
COPY packages/prettier-config/package.json packages/prettier-config/
COPY packages/prisma/package.json     packages/prisma/
COPY packages/signing/package.json    packages/signing/
COPY packages/tailwind-config/package.json packages/tailwind-config/
COPY packages/trpc/package.json       packages/trpc/
COPY packages/tsconfig/package.json   packages/tsconfig/
COPY packages/ui/package.json         packages/ui/

# Install dependencies — cached unless a package.json above changes
RUN --mount=type=cache,target=/root/.npm \
    npm ci --fetch-timeout=60000 --fetch-retries=3

# Install turbo globally (fast, keep cached near installs)
RUN npm install -g turbo@^1.9.3

# Install Chromium for Playwright — required by seal-document for audit cert PDF.
# Cache mount keeps the ~400 MB download across builds.
RUN --mount=type=cache,target=/ms-playwright \
    npx playwright install --with-deps chromium

# ── Now copy the full source ──────────────────────────────────────────────────
COPY apps ./apps
COPY packages ./packages

# Fix line endings for all shell scripts
RUN find . -name "*.sh" -type f -exec dos2unix {} \;

# Build the application — cache mount preserves turbo's incremental build state
RUN --mount=type=cache,target=/app/.turbo \
    npx turbo run build

# Create directory for certificates
RUN mkdir -p /app/certs

# Copy start script and fix line endings
COPY docker/start.sh ./start.sh
RUN dos2unix ./start.sh && chmod +x ./start.sh

# Expose port
EXPOSE 3000

# Start the application
CMD ["./start.sh"]
