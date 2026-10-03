#!/usr/bin/env bash
# Installs the TrainMe test environment on a single k3s node (docs/04 §2):
#   1. operators/gateway (CloudNativePG, Kong Ingress Controller)  2. secrets
#   3. platform chart (Postgres, Keycloak, Valkey, Redpanda, Mailpit)  4. application chart.
# Usage: PUBLIC_URL=http://<vm-host> src/deploy/k3s/install.sh [image-tag]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CHARTS="$HERE/../charts"
TAG="${1:-$(cat "$HERE/.last-tag" 2>/dev/null || echo local)}"
PUBLIC_URL="${PUBLIC_URL:-http://$(hostname -f)}"
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
SECRETS_FILE="$HERE/secrets.env"
[ -f "$SECRETS_FILE" ] || { echo "Create $SECRETS_FILE from secrets.env.example first"; exit 1; }

echo "==> repositories"
helm repo add cnpg https://cloudnative-pg.github.io/charts >/dev/null 2>&1 || true
helm repo add kong https://charts.konghq.com >/dev/null 2>&1 || true
helm repo update >/dev/null

echo "==> CloudNativePG operator"
helm upgrade --install cnpg cnpg/cloudnative-pg --version 0.29.1 -n cnpg-system --create-namespace --wait

echo "==> Kong Ingress Controller (DB-less, proxy on :80 through k3s ServiceLB)"
helm upgrade --install kong kong/ingress --version 0.24.0 -n kong --create-namespace -f "$HERE/kong-values.yaml" --wait

echo "==> namespaces and secrets"
for ns in trainme-platform trainme; do kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - >/dev/null; done
kubectl -n trainme-platform create secret generic trainme-platform-secrets --from-env-file="$SECRETS_FILE" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
set -a; source "$SECRETS_FILE"; set +a
PG=trainme-pg-rw.trainme-platform.svc.cluster.local:5432
kubectl -n trainme create secret generic trainme-db-urls \
  --from-literal=catalog-svc="postgres://catalog_svc:${CATALOG_DB_PASSWORD}@${PG}/catalog_db" \
  --from-literal=tracker-svc="postgres://tracker_svc:${TRACKER_DB_PASSWORD}@${PG}/tracker_db" \
  --from-literal=records-svc="postgres://records_svc:${RECORDS_DB_PASSWORD}@${PG}/records_db" \
  --from-literal=analytics-svc="postgres://analytics_svc:${ANALYTICS_DB_PASSWORD}@${PG}/analytics_db" \
  --from-literal=user-profile-svc="postgres://profile_svc:${PROFILE_DB_PASSWORD}@${PG}/profile_db" \
  --from-literal=subscription-svc="postgres://billing_svc:${BILLING_DB_PASSWORD}@${PG}/billing_db" \
  --from-literal=notification-svc="postgres://notification_svc:${NOTIFICATION_DB_PASSWORD}@${PG}/notification_db" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n trainme create secret generic trainme-app-secrets \
  --from-literal=SERVICE_CLIENT_SECRET="$KEYCLOAK_SERVICES_CLIENT_SECRET" \
  --from-literal=MOCK_PAYMENT_WEBHOOK_SECRET="$MOCK_PAYMENT_WEBHOOK_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

echo "==> platform"
helm upgrade --install trainme-platform "$CHARTS/trainme-platform" -n trainme-platform \
  --set-string publicUrl="$PUBLIC_URL" --wait --timeout 15m
kubectl -n trainme-platform wait --for=condition=Ready cluster/trainme-pg --timeout=10m

echo "==> application (tag $TAG)"
helm dependency update "$CHARTS/trainme" >/dev/null
SETS=(--set-string global.publicUrl="$PUBLIC_URL")
for svc in catalog-svc tracker-svc records-svc analytics-svc user-profile-svc subscription-svc notification-svc; do
  SETS+=(--set-string "$svc.image.tag=$TAG")
done
helm upgrade --install trainme "$CHARTS/trainme" -n trainme -f "$CHARTS/trainme/values-test.yaml" "${SETS[@]}" --wait --timeout 15m

echo "==> done: $PUBLIC_URL  (Keycloak: $PUBLIC_URL/auth, API: $PUBLIC_URL/api/v1)"
kubectl -n trainme get pods
