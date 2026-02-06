#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_LOCAL_FILE="$ROOT_DIR/.env.local"
WORLDCHAIN_SEPOLIA_RPC_URL="${WORLDCHAIN_SEPOLIA_RPC_URL:-https://worldchain-sepolia.g.alchemy.com/public}"
WORLDCHAIN_SEPOLIA_EXPLORER_BASE_URL="${WORLDCHAIN_SEPOLIA_EXPLORER_BASE_URL:-https://sepolia.worldscan.org}"
DEPLOYER_PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY:-}"
WORLD_ID_ROUTER="${WORLD_ID_ROUTER:-0x57f928158C3EE7CDad1e4D8642503c4D0201f611}"
WORLD_ID_APP_ID="${WORLD_ID_APP_ID:-${NEXT_PUBLIC_APP_ID:-}}"
WORLD_ID_ACTION="${WORLD_ID_ACTION:-orbgate}"

if [[ -z "$DEPLOYER_PRIVATE_KEY" ]]; then
  echo "Missing DEPLOYER_PRIVATE_KEY"
  exit 1
fi

if [[ -z "$WORLD_ID_APP_ID" ]]; then
  echo "Missing WORLD_ID_APP_ID (or NEXT_PUBLIC_APP_ID)"
  exit 1
fi

if ! command -v forge >/dev/null 2>&1; then
  echo "forge not found. Install Foundry first: https://book.getfoundry.sh/getting-started/installation"
  exit 1
fi

echo "Deploying FileRegistry to Worldchain Sepolia..."
echo "RPC: $WORLDCHAIN_SEPOLIA_RPC_URL"

DEPLOY_OUTPUT="$(
  cd "$ROOT_DIR" && \
    forge create contracts/FileRegistry.sol:FileRegistry \
      --rpc-url "$WORLDCHAIN_SEPOLIA_RPC_URL" \
      --private-key "$DEPLOYER_PRIVATE_KEY" \
      --constructor-args "$WORLD_ID_ROUTER" "$WORLD_ID_APP_ID" "$WORLD_ID_ACTION" \
      --broadcast
)"

echo "$DEPLOY_OUTPUT"

CONTRACT_ADDRESS="$(printf '%s\n' "$DEPLOY_OUTPUT" | rg -o "0x[a-fA-F0-9]{40}" | tail -n 1)"

if [[ -z "$CONTRACT_ADDRESS" ]]; then
  echo "Failed to parse deployed contract address from forge output."
  exit 1
fi

touch "$ENV_LOCAL_FILE"

update_env_var() {
  local key="$1"
  local value="$2"
  local line="${key}='${value}'"

  if rg -q "^${key}=" "$ENV_LOCAL_FILE"; then
    awk -v target_key="$key" -v target_line="$line" '
      BEGIN { replaced = 0 }
      {
        if ($0 ~ ("^" target_key "=")) {
          print target_line
          replaced = 1
        } else {
          print $0
        }
      }
      END {
        if (replaced == 0) {
          print target_line
        }
      }
    ' "$ENV_LOCAL_FILE" > "${ENV_LOCAL_FILE}.tmp"
    mv "${ENV_LOCAL_FILE}.tmp" "$ENV_LOCAL_FILE"
  else
    printf "%s\n" "$line" >> "$ENV_LOCAL_FILE"
  fi
}

update_env_var "NEXT_PUBLIC_FILE_REGISTRY_CONTRACT_ADDRESS" "$CONTRACT_ADDRESS"
update_env_var "NEXT_PUBLIC_FILE_REGISTRY_RPC_URL" "$WORLDCHAIN_SEPOLIA_RPC_URL"
update_env_var "NEXT_PUBLIC_FILE_REGISTRY_EXPLORER_BASE_URL" "$WORLDCHAIN_SEPOLIA_EXPLORER_BASE_URL"
update_env_var "FILE_REGISTRY_CONTRACT_ADDRESS" "$CONTRACT_ADDRESS"
update_env_var "FILE_REGISTRY_RPC_URL" "$WORLDCHAIN_SEPOLIA_RPC_URL"
update_env_var "FILE_REGISTRY_EXPLORER_BASE_URL" "$WORLDCHAIN_SEPOLIA_EXPLORER_BASE_URL"

echo
echo "Deployment complete"
echo "Contract: $CONTRACT_ADDRESS"
echo "Explorer: $WORLDCHAIN_SEPOLIA_EXPLORER_BASE_URL/address/$CONTRACT_ADDRESS"
echo ".env.local updated: $ENV_LOCAL_FILE"
