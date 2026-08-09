# syntax=docker/dockerfile:1
#
# HubSign documentation portal.
#
# Every page in this site is prerendered — the build reports all 38 routes as
# static — so the runtime image serves files and nothing else. Two consequences
# worth stating, because they are the reason this is not built into the
# application image:
#
#   • No Node process in production. Nothing to crash, no runtime dependency
#     surface, and the image is ~50 MB instead of ~1 GB.
#   • The docs deploy independently. Fixing a typo in the manual does not rebuild
#     or restart the signing application.
#
# Build from the REPOSITORY ROOT, because the workspace manifests are needed to
# install:
#
#   docker build -f apps/documentation/Dockerfile -t jesseframework/hubsign-docs:latest .

# ── Stage 1: build the static site ───────────────────────────────────────────
FROM node:22-slim AS build

ENV HUSKY=0
# Playwright is a dependency of the workspace but is never used by the docs
# build; skipping the browser download saves several hundred megabytes and a
# minute of build time.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Manifests first so `npm ci` is cached across content-only changes — which is
# most changes to a documentation site.
COPY package*.json turbo.json ./
COPY apps/documentation/package.json  apps/documentation/
COPY apps/openpage-api/package.json   apps/openpage-api/
COPY apps/remix/package.json          apps/remix/
COPY packages/api/package.json        packages/api/
COPY packages/app-tests/package.json  packages/app-tests/
COPY packages/assets/package.json     packages/assets/
COPY packages/auth/package.json       packages/auth/
COPY packages/ee/package.json         packages/ee/
COPY packages/email/package.json      packages/email/
COPY packages/lib/package.json        packages/lib/
COPY packages/prisma/package.json     packages/prisma/
COPY packages/signing/package.json    packages/signing/
COPY packages/tailwind-config/package.json packages/tailwind-config/
COPY packages/trpc/package.json       packages/trpc/
COPY packages/ui/package.json         packages/ui/

RUN npm ci --ignore-scripts

# Only what the docs build actually reads. The application source is not copied,
# so a change to the signing app cannot invalidate this layer.
COPY apps/documentation/ apps/documentation/
COPY packages/assets/    packages/assets/
COPY packages/tailwind-config/ packages/tailwind-config/
COPY packages/ui/        packages/ui/

WORKDIR /app/apps/documentation

# Switches next.config.js to `output: 'export'`. Gated on an env var so local
# `next start` keeps working — `output: 'export'` is incompatible with it.
ENV DOCS_STATIC_EXPORT=1

# Deployment addresses the documentation links to. This is a static export, so
# these are inlined at build time and cannot be changed on a running container —
# override them here (Komodo: the build's `build_args`) and rebuild.
ARG NEXT_PUBLIC_HUBSIGN_APP_URL=https://app.hubsign.io
ARG NEXT_PUBLIC_HUBSIGN_SITE_URL=https://hubsign.io
ARG NEXT_PUBLIC_HUBSIGN_SUPPORT_EMAIL=support@hubsign.io

ENV NEXT_PUBLIC_HUBSIGN_APP_URL=$NEXT_PUBLIC_HUBSIGN_APP_URL \
    NEXT_PUBLIC_HUBSIGN_SITE_URL=$NEXT_PUBLIC_HUBSIGN_SITE_URL \
    NEXT_PUBLIC_HUBSIGN_SUPPORT_EMAIL=$NEXT_PUBLIC_HUBSIGN_SUPPORT_EMAIL

RUN npx next build

# ── Stage 2: serve ───────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY apps/documentation/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/documentation/out /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
