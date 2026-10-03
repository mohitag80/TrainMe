#!/usr/bin/env bash
# Creates the TrainMe topics (LLD §5) idempotently. Partition counts are the test-environment sizes.
set -euo pipefail
create() { # topic partitions retention-ms
  rpk topic create "$1" -p "$2" -r 1 -c retention.ms="$3" -c cleanup.policy=delete 2>&1 | grep -v 'TOPIC_ALREADY_EXISTS' || true
}
DAY=86400000
create user.events            3  $((7 * DAY))
create subscription.events    3  $((7 * DAY))
create catalog.events         1  $((30 * DAY))
create tracker.events         3  $((30 * DAY))
create record.events          6  $((30 * DAY))
create analytics.events       3  $((7 * DAY))
create notification.commands  3  $((3 * DAY))
for t in user.events subscription.events catalog.events tracker.events record.events analytics.events notification.commands; do
  create "$t.dlq" 1 $((14 * DAY))
done
rpk topic list
