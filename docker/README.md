# Boletera Docker images

Ownership of this folder is exclusive for container packaging. Do **not** expect these Dockerfiles to edit `apps/`, `packages/`, or the repo root.

## Prerequisites

| Tool | Version |
|------|---------|
| Node (in images) | 22 (Alpine) |
| pnpm | 10.30.3 (via Corepack) |
| Docker Buildx | required (`--ignorefile`, heredocs) |

**Always build from the repo root.** Prefer the helpers (they temporarily swap in `docker/.dockerignore`):

```powershell
./docker/build.ps1 -Dockerfile docker/api.Dockerfile -Tag boletera-api
```

```bash
./docker/build.sh docker/api.Dockerfile boletera-api
```

The root `.dockerignore` excludes `pnpm-workspace.yaml`, `turbo.json`, and `tsconfig*.json`, which breaks monorepo installs. This Docker CLI also lacks `--ignorefile`, so use `docker/build.ps1` / `docker/build.sh` (or manually replace the root ignore file before `docker build`).

## Images

| File | Package | Port | Healthcheck |
|------|---------|------|-------------|
| `api.Dockerfile` | `@boletera/api` | `4000` | `GET /api/v1/health` |
| `worker.Dockerfile` | `@boletera/worker` | `4100` (health) | `GET /health` |
| `web.Dockerfile` | `@boletera/web` | `3000` | `GET /` |
| `admin.Dockerfile` | `@boletera/admin` | `3001` | `GET /` |
| `taquilla.Dockerfile` | `@boletera/taquilla` | `3002` | `GET /` |

Common runtime traits:

- Multi-stage (`turbo prune` → install → build → pruned deploy)
- Non-root user `boletera` (uid/gid `1001`)
- `tini` as PID 1 (`ENTRYPOINT`)
- Alpine + `HEALTHCHECK`

## Build examples

```powershell
# API / worker
./docker/build.ps1 -Dockerfile docker/api.Dockerfile -Tag boletera-api
./docker/build.ps1 -Dockerfile docker/worker.Dockerfile -Tag boletera-worker

# Next apps (bake public API URLs at build time)
./docker/build.ps1 -Dockerfile docker/web.Dockerfile -Tag boletera-web -BuildArgs @{
  NEXT_PUBLIC_API_URL = "https://api.example.com/api/v1"
  NEXT_PUBLIC_WEB_URL = "https://www.example.com"
}
./docker/build.ps1 -Dockerfile docker/admin.Dockerfile -Tag boletera-admin -BuildArgs @{
  NEXT_PUBLIC_ADMIN_API_URL = "https://api.example.com/api/v1"
}
./docker/build.ps1 -Dockerfile docker/taquilla.Dockerfile -Tag boletera-taquilla -BuildArgs @{
  NEXT_PUBLIC_API_URL = "https://api.example.com/api/v1"
}
```

## BLOCKER: Next.js `output: 'standalone'` is not enabled

Checked configs (no edits allowed outside `docker/**`):

- `apps/web/next.config.ts` — no `output: 'standalone'`
- `apps/admin/next.config.ts` — no `output: 'standalone'`
- `apps/taquilla/next.config.ts` — no `output: 'standalone'`

Therefore the Next Dockerfiles are **functional via `next start`**, shipping production `node_modules` + `.next`. Images are larger than a standalone runner.

To unlock smaller Next images later (outside this ownership boundary), add to each app’s `next.config.ts`:

```ts
const nextConfig = {
  output: 'standalone',
  // ...existing config
};
```

Then the runner stage can copy only `.next/standalone` + `.next/static` + `public`.

## Other runtime notes (image-side workarounds)

1. **`@boletera/database` `main` points at `.ts`** — cannot change packages from here. API/worker Dockerfiles rewrite `main` → `./src/index.js` inside the image after build.
2. **`pnpm deploy` skips gitignored `dist/` and `.next/`** — Dockerfiles overlay those artifacts after deploy.
3. **Root `postinstall` (`db:generate`)** — skipped during image `pnpm install` (`--ignore-scripts`); API/worker run `prisma:generate` explicitly in the builder stage.
4. **`pnpm deploy --legacy`** — required on pnpm 10 without `inject-workspace-packages`.
5. **API `nest build` may exit non-zero** when `apps/api` has TypeScript diagnostics (outside `docker/**`). The API Dockerfile still requires `apps/api/dist/main.js` after emit (`noEmitOnError: false`).
6. **Legacy root files** `Dockerfile.api` / `Dockerfile.web` are superseded by `docker/*.Dockerfile` (compose under root was not modified).

## Smoke / syntax checks

```powershell
# Prune stage only (fast syntax + turbo prune smoke)
./docker/build.ps1 -Dockerfile docker/api.Dockerfile -Tag boletera-api:pruner -Target pruner

# Full image build
./docker/build.ps1 -Dockerfile docker/api.Dockerfile -Tag boletera-api
```

## Known external blockers (cannot fix under `docker/**` ownership)

| Issue | Impact |
|-------|--------|
| Next apps missing `output: 'standalone'` | Larger Next images; use `next start` |
| Root `.dockerignore` drops workspace config | Must use `docker/build.*` (restores original ignore after build) |
| `@boletera/database` `main` → `.ts` | Rewritten only inside API/worker images |
| `apps/api` has TS diagnostics | API Dockerfile tolerates non-zero `nest build` if `dist/main.js` is emitted |
| Root `docker-compose.yml` still points at legacy `Dockerfile.api` / `Dockerfile.web` | Compose not updated (outside ownership) |
