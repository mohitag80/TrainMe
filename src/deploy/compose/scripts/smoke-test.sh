#!/usr/bin/env bash
# Quick end-to-end check of a running TrainMe stack through Kong (docs/11 §13).
#   BASE_URL=http://mohitconcert11.fyre.ibm.com:8000 src/deploy/compose/scripts/smoke-test.sh
# Exit code 0 = every check passed. Extend this script as services are added.
set -uo pipefail
BASE_URL="${BASE_URL:-http://localhost:8000}"
API="$BASE_URL/api/v1"
TOKEN_URL="$BASE_URL/auth/realms/trainme/protocol/openid-connect/token"
PASSWORD="${TEST_USER_PASSWORD:-Passw0rd!}"
fails=0

check() { # name expected-status url [curl args...]
  local name="$1" expected="$2" url="$3"; shift 3
  local code
  code=$(curl -s -o /tmp/smoke.out -w "%{http_code}" "$@" "$url")
  if [ "$code" = "$expected" ]; then printf "  ✅ %-45s %s\n" "$name" "$code"
  else printf "  ❌ %-45s got %s, expected %s\n" "$name" "$code" "$expected"; fails=$((fails + 1)); fi
}

token() {
  curl -s -d grant_type=password -d client_id=trainme-cli -d "username=$1" -d "password=$PASSWORD" "$TOKEN_URL" |
    python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))'
}

echo "Stack: $BASE_URL"
echo "Identity"
check "OIDC discovery" 200 "$BASE_URL/auth/realms/trainme/.well-known/openid-configuration"
MEMBER=$(token asha@trainme.test)
CURATOR=$(token coach@trainme.test)
[ -n "$MEMBER" ] && echo "  ✅ token for asha@trainme.test (member)" || { echo "  ❌ token for asha@trainme.test"; fails=$((fails + 1)); }
[ -n "$CURATOR" ] && echo "  ✅ token for coach@trainme.test (curator)" || { echo "  ❌ token for coach@trainme.test"; fails=$((fails + 1)); }

echo "catalog-svc"
check "units" 200 "$API/units"
check "category tree" 200 "$API/categories"
check "templates in cricket" 200 "$API/templates?category=cricket"
check "template cricket.fast_bowler" 200 "$API/templates/cricket.fast_bowler"
check "activity gym.back_squat" 200 "$API/activities/gym.back_squat"
check "search with typo" 200 "$API/catalog/search?q=dumbell%20chest"
grep -q dumbbell_bench_press /tmp/smoke.out && echo "  ✅ typo search finds dumbbell bench press" || { echo "  ❌ typo search result"; fails=$((fails + 1)); }
check "suggest" 200 "$API/catalog/suggest?q=squ"
check "unknown template → 404" 404 "$API/templates/does.not.exist"
check "invalid search → 422" 422 "$API/catalog/search?q="
check "admin without token → 401" 401 "$API/admin/catalog/templates"
check "admin as member → 403" 403 "$API/admin/catalog/templates" -H "Authorization: Bearer $MEMBER"
check "admin as curator → 200" 200 "$API/admin/catalog/templates" -H "Authorization: Bearer $CURATOR"

echo
[ "$fails" -eq 0 ] && echo "All checks passed." || echo "$fails check(s) failed."
exit "$fails"
