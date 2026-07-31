# syntax=docker/dockerfile:1.7
#
# Build (from repo root):
#   docker build -f docker/api.Dockerfile --ignorefile docker/.dockerignore -t boletera-api .
#
# Multi-stage: turbo prune → install → build → pnpm deploy (prod) + overlay dist.

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.30.3

FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
RUN apk add --no-cache libc6-compat tini openssl \
  && corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /app

# --- prune workspace to api + deps ---
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.9.14 prune @boletera/api --docker

# --- install deps (native modules + prisma generate via postinstall) ---
FROM base AS deps
RUN apk add --no-cache python3 make g++
ENV CI=true \
    DATABASE_URL="postgresql://postgres:postgres@localhost:5432/boletera?schema=public"
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
# Prisma schema/scripts needed if postinstall → db:generate runs
COPY --from=pruner /app/out/full/packages/database/prisma ./packages/database/prisma
COPY --from=pruner /app/out/full/packages/database/scripts ./packages/database/scripts
COPY --from=pruner /app/prisma.config.ts ./prisma.config.ts
# Ignore root postinstall; prisma generate runs in builder. Rebuild native addons.
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm rebuild bcrypt

# --- build ---
FROM base AS builder
ENV CI=true \
    NODE_ENV=production \
    DATABASE_URL="postgresql://postgres:postgres@localhost:5432/boletera?schema=public"
COPY --from=deps /app/ .
COPY --from=pruner /app/out/full/ .
COPY turbo.json tsconfig.json tsconfig.packages.json ./
# Build workspace deps with the real root tsconfig, then hide it so Nest uses
# apps/api/tsconfig.json (experimentalDecorators). Root include: apps/**/* can
# otherwise pull API sources into a program without decorators enabled.
# nest build may exit non-zero on existing app TS diagnostics; require emit.
RUN pnpm --filter @boletera/database prisma:generate \
  && pnpm turbo run build --filter=@boletera/api^... \
  && mv tsconfig.json tsconfig.root.json \
  && (pnpm --filter @boletera/api build || true) \
  && mv tsconfig.root.json tsconfig.json \
  && test -f apps/api/dist/main.js

# @boletera/database package.json points main at .ts (cannot edit apps/packages).
# Rewrite main to the sibling .js so plain `node` can require the package at runtime.
RUN node <<'EOF'
const fs = require('fs');
const p = 'packages/database/package.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.main = './src/index.js';
if (j.types) j.types = './src/index.d.ts';
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
EOF

# pnpm deploy omits gitignored `dist/`; overlay built artifacts after deploy.
# Also sync Prisma generated client into deploy node_modules (musl binaries from Alpine generate).
RUN pnpm --filter=@boletera/api deploy --legacy --prod /deploy \
  && cp -a apps/api/dist /deploy/dist \
  && for pkg in shared crypto payments venue-engine; do \
       if [ -d "packages/${pkg}/dist" ]; then \
         mkdir -p "/deploy/node_modules/@boletera/${pkg}" \
         && rm -rf "/deploy/node_modules/@boletera/${pkg}/dist" \
         && cp -a "packages/${pkg}/dist" "/deploy/node_modules/@boletera/${pkg}/dist"; \
       fi; \
     done \
  && if [ -f /deploy/node_modules/@boletera/database/package.json ]; then \
       node -e "const fs=require('fs');const p='/deploy/node_modules/@boletera/database/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.main='./src/index.js';if(j.types)j.types='./src/index.d.ts';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"; \
     fi \
  && if [ -d packages/database/generated/client ]; then \
       mkdir -p /deploy/node_modules/.prisma \
       && rm -rf /deploy/node_modules/.prisma/client \
       && cp -a packages/database/generated/client /deploy/node_modules/.prisma/client \
       && if [ -d /deploy/node_modules/@boletera/database ]; then \
            mkdir -p /deploy/node_modules/@boletera/database/generated \
            && rm -rf /deploy/node_modules/@boletera/database/generated/client \
            && cp -a packages/database/generated/client /deploy/node_modules/@boletera/database/generated/client; \
          fi \
       && if [ -d /deploy/node_modules/.pnpm ]; then \
            for d in /deploy/node_modules/.pnpm/@prisma+client@*; do \
              [ -d "$d" ] || continue; \
              mkdir -p "$d/node_modules/.prisma"; \
              rm -rf "$d/node_modules/.prisma/client"; \
              cp -a packages/database/generated/client "$d/node_modules/.prisma/client"; \
            done; \
          fi; \
     fi

# --- runtime ---
FROM node:${NODE_VERSION}-alpine AS runner
ARG PNPM_VERSION
RUN apk add --no-cache libc6-compat tini openssl wget \
  && addgroup -g 1001 -S boletera \
  && adduser -S -u 1001 -G boletera boletera
WORKDIR /app
ENV NODE_ENV=production \
    API_PORT=4000 \
    API_HOST=0.0.0.0
COPY --from=builder --chown=boletera:boletera /deploy/ ./
USER boletera
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${API_PORT:-4000}/api/v1/health" >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
