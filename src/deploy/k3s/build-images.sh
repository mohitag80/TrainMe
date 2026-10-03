#!/usr/bin/env bash
# Builds every TrainMe image with Docker and imports it into k3s' containerd (no registry needed).
#   src/deploy/k3s/build-images.sh [tag]        (default tag: current git short SHA)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TAG="${1:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo local)}"
SERVICES=(catalog-svc tracker-svc records-svc analytics-svc user-profile-svc subscription-svc notification-svc)

import() { docker save "$1" | sudo k3s ctr -n k8s.io images import - >/dev/null && echo "imported $1"; }

docker build -t "trainme-postgres-cnpg:17" -f "$ROOT/src/deploy/docker/postgres/Dockerfile.cnpg" "$ROOT/src/deploy/docker/postgres"
import "trainme-postgres-cnpg:17"

for svc in "${SERVICES[@]}"; do
  [ -d "$ROOT/src/services/$svc/src" ] || { echo "skip $svc (not implemented yet)"; continue; }
  docker build -t "trainme-$svc:$TAG" --build-arg SERVICE="$svc" -f "$ROOT/src/deploy/docker/service.Dockerfile" "$ROOT"
  import "trainme-$svc:$TAG"
done
echo "$TAG" > "$ROOT/src/deploy/k3s/.last-tag"
