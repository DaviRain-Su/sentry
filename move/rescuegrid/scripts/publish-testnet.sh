#!/usr/bin/env bash
# Publish the RescueGrid Move package to Sui Testnet and print the resulting
# package id + UpgradeCap. Links against the already-deployed MoveGate
# (vendored ../movegate with published-at set), so MoveGate is NOT republished.
#
# Usage:
#   ./publish-testnet.sh            # dry-run (no broadcast, verifies linkage)
#   ./publish-testnet.sh --execute  # actually publish (spends testnet gas)
#
# Prereqs: `sui client active-env` == testnet, funded active address.
set -euo pipefail
cd "$(dirname "$0")/.."   # move/rescuegrid

GAS_BUDGET="${GAS_BUDGET:-200000000}"   # 0.2 SUI
MODE="${1:---dry-run}"

echo "env:    $(sui client active-env)"
echo "signer: $(sui client active-address)"
echo "mode:   $MODE"

if [ "$MODE" = "--execute" ]; then
  OUT=$(sui client publish --gas-budget "$GAS_BUDGET" --json)
  PKG=$(echo "$OUT" | jq -r '.objectChanges[] | select(.type=="published") | .packageId')
  UPGRADE_CAP=$(echo "$OUT" | jq -r '.objectChanges[] | select(.objectType? // "" | endswith("::package::UpgradeCap")) | .objectId')
  DIGEST=$(echo "$OUT" | jq -r '.digest')
  echo "----------------------------------------"
  echo "RESCUEGRID_PACKAGE_ID=$PKG"
  echo "RESCUEGRID_UPGRADE_CAP=$UPGRADE_CAP"
  echo "publish_tx_digest=$DIGEST"
  echo "----------------------------------------"
  echo "Next: register the agent passport once (movegate::passport::register_agent),"
  echo "then create a policy (rescuegrid::policy::create_policy) to mint the shared"
  echo "Mandate + RescuePolicyWrapper; the wrapper object id is emitted in PolicyCreated."
else
  # Dry-run: builds, resolves the on-chain MoveGate dependency and simulates publish.
  sui client publish --gas-budget "$GAS_BUDGET" --dry-run
fi
