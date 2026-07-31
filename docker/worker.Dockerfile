# syntax=docker/dockerfile:1.7
#
# Build (from repo root):
#   docker build -f docker/worker.Dockerfile --ignorefile docker/.dockerignore -t boletera-worker .
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

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.9.14 prune @boletera/worker --docker

FROM base AS deps
RUN apk add --no-cache python3 make g++
ENV CI=true \
    DATABASE_URL="postgresql://postgres:postgres@localhost:5432/boletera?schema=public"
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/full/packages/database/prisma ./packages/database/prisma
COPY --from=pruner /app/out/full/packages/database/scripts ./packages/database/scripts
COPY --from=pruner /app/prisma.config.ts ./prisma.config.ts
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm rebuild bcrypt || true

FROM base AS builder
ENV CI=true \
    NODE_ENV=production \
    DATABASE_URL="postgresql://postgres:postgres@localhost:5432/boletera?schema=public"
COPY --from=deps /app/ .
COPY --from=pruner /app/out/full/ .
COPY turbo.json tsconfig.json tsconfig.packages.json ./
RUN pnpm --filter @boletera/database prisma:generate \
  && pnpm turbo run build --filter=@boletera/worker...

RUN node <<'EOF'
const fs = require('fs');
const p = 'packages/database/package.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.main = './src/index.js';
if (j.types) j.types = './src/index.d.ts';
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
EOF

RUN pnpm --filter=@boletera/worker deploy --legacy --prod /deploy \
  && cp -a apps/worker/dist /deploy/dist \
  && for pkg in shared venue-engine; do \
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

FROM node:${NODE_VERSION}-alpine AS runner
ARG PNPM_VERSION
RUN apk add --no-cache libc6-compat tini openssl wget \
  && addgroup -g 1001 -S boletera \
  && adduser -S -u 1001 -G boletera boletera
WORKDIR /app
ENV NODE_ENV=production \
    WORKER_HEALTH_PORT=4100
COPY --from=builder --chown=boletera:boletera /deploy/ ./
USER boletera
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${WORKER_HEALTH_PORT:-4100}/health" >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
