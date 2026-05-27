FROM node:20-slim AS base

# Update packages and install build tools.
# - qpdf is required at runtime to lock signed PDFs with a user-set password.
# - The libnss3/libatk*/libcups2/etc. cluster is required by Chromium so
#   Playwright can render the audit certificate page to PDF at seal time.
#   Without these libs `chromium.launch()` throws and the cert is dropped
#   silently — which is what was causing certificates to appear in dev but
#   not in production.
RUN apt-get update && apt-get install -y \
  build-essential \
  python3 \
  libvips-dev \
  git \
  bash \
  ca-certificates \
  curl \
  qpdf \
  libnss3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libpango-1.0-0 \
  libcairo2 \
  libasound2 \
  libatspi2.0-0 \
  libdrm2 \
  fonts-liberation \
  fonts-noto-color-emoji && \
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

# Install only Playwright's Chromium browser into a persistent path so the
# pruned production install can launch it. We do this AFTER `npm prune`
# because Playwright's NPM package stays in the runtime tree (it's a prod
# dependency), but the browser binary is downloaded separately and only
# fetched if `playwright install` runs. Without this step `chromium.launch()`
# throws "Executable doesn't exist" in the production runner stage.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright
RUN npx playwright install chromium

# --- Runner stage ---
FROM base AS runner

ENV HUSKY=0
ENV DOCKER_OUTPUT=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

USER nodejs
WORKDIR /app

# Make the Chromium binaries we installed in the installer stage discoverable
# at runtime. Must match the path used for `playwright install` above.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright

COPY --from=installer --chown=nodejs:nodejs /app ./

RUN npx prisma generate --schema ./packages/prisma/schema.prisma

COPY --chown=nodejs:nodejs ./docker/start.sh /app/apps/remix/start.sh

WORKDIR /app/apps/remix
CMD ["sh", "start.sh"]
