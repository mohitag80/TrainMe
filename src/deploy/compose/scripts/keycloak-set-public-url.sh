#!/usr/bin/env bash
# Points the Keycloak web client at TRAINME_PUBLIC_URL (redirect URIs, web origins, logout redirect).
# Needed after changing the public URL: the realm file is imported only on the first start.
#   cd src/deploy/compose && scripts/keycloak-set-public-url.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
kc() { docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@" </dev/null; }
kc config credentials --server http://localhost:8080/auth --realm master --user admin --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null
CID=$(kc get clients -r trainme -q clientId=trainme-web --fields id --format csv --noquotes)
kc update "clients/$CID" -r trainme \
  -s "rootUrl=$TRAINME_PUBLIC_URL" \
  -s "redirectUris=[\"$TRAINME_PUBLIC_URL/*\",\"http://localhost:3000/*\"]" \
  -s 'webOrigins=["+"]' \
  -s "attributes.\"post.logout.redirect.uris\"=$TRAINME_PUBLIC_URL/*##http://localhost:3000/*"
echo "trainme-web now redirects to $TRAINME_PUBLIC_URL"
