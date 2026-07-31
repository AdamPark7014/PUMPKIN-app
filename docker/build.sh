#!/usr/bin/env sh
# Build a Boletera image using docker/.dockerignore (repo-root context).
# Many Docker CLIs lack --ignorefile; this script replaces root .dockerignore
# contents for the build and always restores the original bytes.
#
# Usage:
#   ./docker/build.sh docker/api.Dockerfile boletera-api
#   ./docker/build.sh docker/web.Dockerfile boletera-web --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api/v1

set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
DOCKERFILE="${1:?usage: $0 <dockerfile> <tag> [extra docker build args...]}"
TAG="${2:?usage: $0 <dockerfile> <tag> [extra docker build args...]}"
shift 2

DOCKERIGNORE="$ROOT/.dockerignore"
PREFERRED="$ROOT/docker/.dockerignore"
BAK="$(mktemp)"

cd "$ROOT"
had_ignore=0
if [ -f "$DOCKERIGNORE" ]; then
  cp "$DOCKERIGNORE" "$BAK"
  had_ignore=1
fi

cleanup() {
  if [ "$had_ignore" -eq 1 ]; then
    cp "$BAK" "$DOCKERIGNORE"
  else
    rm -f "$DOCKERIGNORE"
  fi
  rm -f "$BAK"
}
trap cleanup EXIT INT TERM

cp "$PREFERRED" "$DOCKERIGNORE"

echo ">> docker build -f $DOCKERFILE -t $TAG $* ."
docker build -f "$DOCKERFILE" -t "$TAG" "$@" .
