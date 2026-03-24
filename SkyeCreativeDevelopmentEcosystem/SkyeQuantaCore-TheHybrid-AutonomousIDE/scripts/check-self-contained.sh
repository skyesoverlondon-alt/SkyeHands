#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PATTERN='SkyeVendors|/workspaces/SkyeHands/SkyeVendors'
SELF_FILE="$ROOT_DIR/scripts/check-self-contained.sh"

echo "Scanning startup and setup surfaces for external vendor-root dependencies..."

if command -v rg >/dev/null 2>&1; then
  if rg -n "$PATTERN" \
    "$ROOT_DIR/package.json" \
    "$ROOT_DIR/Makefile" \
    "$ROOT_DIR/apps" \
    "$ROOT_DIR/scripts" \
    -g '!scripts/check-self-contained.sh'; then
    echo "External vendor-root dependency references were found in product surfaces." >&2
    exit 1
  fi
else
  if grep -RInE "$PATTERN" \
    "$ROOT_DIR/package.json" \
    "$ROOT_DIR/Makefile" \
    "$ROOT_DIR/apps" \
    "$ROOT_DIR/scripts" | grep -v "$SELF_FILE"; then
    echo "External vendor-root dependency references were found in product surfaces." >&2
    exit 1
  fi
fi

echo "Self-contained dependency audit passed."