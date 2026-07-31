# syntax=docker/dockerfile:1.7
#
# Build (from repo root):
#   docker build -f docker/taquilla.Dockerfile --ignorefile docker/.dockerignore \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api/v1 \
#     -t boletera-taquilla .
#
# BLOCKER: apps/taquilla/next.config.ts has no `output: 'standalone'`.
# This image uses `next start` (full node_modules + .next). Smaller images
# require enabling standalone in the app config (outside docker/** ownership).

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.30.3

FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
RUN apk add --no-cache libc6-compat tini \
  && corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /app

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.9.14 prune @boletera/taquilla --docker

FROM base AS deps
RUN apk add --no-cache python3 make g++
ENV CI=true
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM base AS builder
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV CI=true \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY --from=deps /app/ .
COPY --from=pruner /app/out/full/ .
COPY turbo.json tsconfig.json tsconfig.packages.json ./
RUN pnpm turbo run build --filter=@boletera/taquilla...

RUN pnpm --filter=@boletera/taquilla deploy --legacy --prod /deploy \
  && cp -a apps/taquilla/.next /deploy/.next \
  && if [ -d apps/taquilla/public ]; then cp -a apps/taquilla/public /deploy/public; fi \
  && cp apps/taquilla/next.config.ts /deploy/next.config.ts \
  && for pkg in shared venue-engine; do \
       if [ -d "packages/${pkg}/dist" ]; then \
         mkdir -p "/deploy/node_modules/@boletera/${pkg}" \
         && rm -rf "/deploy/node_modules/@boletera/${pkg}/dist" \
         && cp -a "packages/${pkg}/dist" "/deploy/node_modules/@boletera/${pkg}/dist"; \
       fi; \
     done

FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache libc6-compat tini wget \
  && addgroup -g 1001 -S boletera \
  && adduser -S -u 1001 -G boletera boletera
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3002 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=boletera:boletera /deploy/ ./
USER boletera
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3002}/" >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3002"]
