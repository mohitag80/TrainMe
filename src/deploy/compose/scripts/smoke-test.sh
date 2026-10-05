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
  code=$(curl -sk -o /tmp/smoke.out -w "%{http_code}" "$@" "$url")
  if [ "$code" = "$expected" ]; then printf "  ✅ %-45s %s\n" "$name" "$code"
  else printf "  ❌ %-45s got %s, expected %s\n" "$name" "$code" "$expected"; fails=$((fails + 1)); fi
}

token() {
  curl -sk -d grant_type=password -d client_id=trainme-cli -d "username=$1" -d "password=$PASSWORD" "$TOKEN_URL" |
    python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))'
}

echo "Stack: $BASE_URL"
echo "Identity"
check "OIDC discovery" 200 "$BASE_URL/auth/realms/trainme/.well-known/openid-configuration"
MEMBER=$(token asha@trainme.test)
CURATOR=$(token admin@trainme.test)
[ -n "$MEMBER" ] && echo "  ✅ token for asha@trainme.test (member)" || { echo "  ❌ token for asha@trainme.test"; fails=$((fails + 1)); }
[ -n "$CURATOR" ] && echo "  ✅ token for admin@trainme.test (admin, curator)" || { echo "  ❌ token for admin@trainme.test"; fails=$((fails + 1)); }

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


echo "user-profile-svc"
check "my profile (auto-created)" 200 "$API/profiles/me" -H "Authorization: Bearer $MEMBER"
check "support search as member → 403" 403 "$API/profiles?q=asha" -H "Authorization: Bearer $MEMBER"

echo "tracker-svc + records-svc (live session)"
J() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
TID=$(curl -sk -X POST "$API/trackers" -H "Authorization: Bearer $MEMBER" -H 'content-type: application/json' -d '{"templateCode":"cricket.fast_bowler","displayName":"Smoke Bowling"}' | J "d.get('id','')")
[ -n "$TID" ] && echo "  ✅ create tracker from template" || { echo "  ❌ create tracker"; fails=$((fails + 1)); }
check "tracker schema" 200 "$API/trackers/$TID/schema" -H "Authorization: Bearer $MEMBER"
RUN=$(date +%s)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SID=$(curl -sk -X POST "$API/sessions" -H "Authorization: Bearer $MEMBER" -H 'content-type: application/json' \
  -d "{\"clientSessionId\":\"$(python3 -c 'import uuid;print(uuid.uuid4())')\",\"trackerId\":\"$TID\",\"name\":\"Smoke Nets $RUN\",\"startedAt\":\"$NOW\",\"timezone\":\"Asia/Kolkata\"}" | J "d.get('id','')")
[ -n "$SID" ] && echo "  ✅ start named session" || { echo "  ❌ start session"; fails=$((fails + 1)); }
check "same name same day → 409" 409 "$API/sessions" -X POST -H "Authorization: Bearer $MEMBER" -H 'content-type: application/json' \
  -d "{\"clientSessionId\":\"$(python3 -c 'import uuid;print(uuid.uuid4())')\",\"trackerId\":\"$TID\",\"name\":\"smoke nets $RUN\",\"startedAt\":\"$NOW\",\"timezone\":\"Asia/Kolkata\"}"
BALLS=$(python3 - "$NOW" <<'PY'
import json, sys, uuid
now = sys.argv[1]
b = [{"clientEntryId": str(uuid.uuid4()), "activity": "cricket.fast.delivery", "seq": i, "group": (i - 1) // 6 + 1, "recordedAt": now,
      "values": {"speed_kmph": 128 + i, "yorker_attempted": i % 2 == 0, **({"yorker_accurate": i % 4 == 0} if i % 2 == 0 else {}),
                 "seam_attempted": False, "bouncer_attempted": False, "swing_attempted": False, "slower_ball_attempted": False, "no_ball": False}} for i in range(1, 9)]
print(json.dumps({"batchSeq": 1, "schemaVersion": 1, "entries": b}))
PY
)
check "checkpoint 8 balls" 200 "$API/sessions/$SID/entries:batch" -X POST -H "Authorization: Bearer $MEMBER" -H 'content-type: application/json' -d "$BALLS"
check "complete session" 200 "$API/sessions/$SID/complete" -X POST -H "Authorization: Bearer $MEMBER" -H 'content-type: application/json' -d "{\"endedAt\":\"$NOW\",\"entryCount\":8}"

echo "analytics-svc (fed by record.events)"
sleep 4
YACC=$(curl -sk "$API/analytics/series?trackerId=$TID&activity=cricket.fast.delivery&metric=yorker_accuracy&granularity=DAY" -H "Authorization: Bearer $MEMBER" | J "' '.join(f\"{p['num']}/{p['den']}\" for p in d['points'])")
[ "$YACC" = "2/4" ] && echo "  ✅ yorker accuracy rollup = 2/4" || { echo "  ❌ yorker accuracy rollup (got '$YACC')"; fails=$((fails + 1)); }
check "summary" 200 "$API/analytics/summary?trackerId=$TID" -H "Authorization: Bearer $MEMBER"

echo "subscription-svc (mock payments) + notification-svc"
check "plans (public)" 200 "$API/plans"
check "my subscription" 200 "$API/subscriptions/me" -H "Authorization: Bearer $MEMBER"
check "forged webhook → 401" 401 "$API/webhooks/payments/mock" -X POST -H 'content-type: application/json' -H 'x-mock-signature: t=1,v1=00' -d '{"id":"evt_smoke","type":"checkout.completed","data":{"userId":"00000000-0000-0000-0000-000000000000","planCode":"PRO"}}'
check "inbox" 200 "$API/notifications" -H "Authorization: Bearer $MEMBER"

check "delete smoke tracker" 204 "$API/trackers/$TID" -X DELETE -H "Authorization: Bearer $MEMBER"

echo "web app"
check "login page" 200 "$BASE_URL/login"
check "dashboard redirects when signed out" 307 "$BASE_URL/dashboard"
echo
[ "$fails" -eq 0 ] && echo "All checks passed." || echo "$fails check(s) failed."
exit "$fails"
