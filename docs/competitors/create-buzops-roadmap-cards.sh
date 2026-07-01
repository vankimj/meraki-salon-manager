#!/usr/bin/env bash
# Creates the four "move upmarket to gyms" roadmap cards on the Plume Nexus board.
# Run from a shell where `gh` is authed with `project` scope (e.g. VS Code / Claude Code).
# Idempotency: this does NOT dedupe — run once. Re-running creates duplicate issues.
set -euo pipefail

PROJ=PVT_kwHOBbclvc4BZ3cw            # project node id
FIELD=PVTSSF_lAHOBbclvc4BZ3cwzhUzJ7Y # Status field id
BACKLOG=e701ac56                      # Status option: Backlog

add_card() {
  local title="$1"; local body="$2"; shift 2
  local label_args=(); for l in "$@"; do label_args+=(--label "$l"); done
  echo "Creating: $title"
  local url; url=$(gh issue create --title "$title" --body "$body" "${label_args[@]}")
  local item; item=$(gh project item-add 1 --owner vankimj --url "$url" --format json \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
  gh project item-edit --id "$item" --project-id "$PROJ" --field-id "$FIELD" \
    --single-select-option-id "$BACKLOG"
  echo "  -> $url (Backlog)"
}

add_card "Memberships & recurring-billing model" \
"Gym/studio upmarket enabler (see docs/competitors/BUZZOPS-SWITCHING-STRATEGY.md).

Add a memberships/plans data model distinct from appointments: recurring tiered plans, contracts (term + end date), freezes/holds, family/multi-member plans, prepaid packages, and account credits. Prereq for any gym tenant and for clean BuzzOps migration (membership terms must import, not just contact info)." \
  feature p2

add_card "Class scheduling: capacity, waitlist, check-in" \
"Group-fitness scheduling (see docs/competitors/BUZZOPS-SWITCHING-STRATEGY.md).

Reservations against a class capacity with waitlist promotion and member check-in — distinct from the salon tech-column day grid in src/modules/schedule/ScheduleAdmin.jsx. Needed for any class-based studio." \
  feature

add_card "Door / access-control integration" \
"24/7 access control (see docs/competitors/BUZZOPS-SWITCHING-STRATEGY.md).

Keyfob / app-based door entry for unstaffed hours. Hard dealbreaker for any 24/7 gym evaluating Plume Nexus. Likely a hardware/vendor integration (infra). Gate behind real demand — only build once we have a 24/7 prospect pulling for it." \
  feature infra

add_card "Native member app" \
"Member-facing native app (see docs/competitors/BUZZOPS-SWITCHING-STRATEGY.md).

Let members book classes, check in, and view their membership/billing from their phone. Table stakes vs. BuzzOps native apps; also one of our standing honest gaps in docs/competitors/competitor-landscape.md." \
  feature mobile

echo "Done. 4 cards added to Backlog."
