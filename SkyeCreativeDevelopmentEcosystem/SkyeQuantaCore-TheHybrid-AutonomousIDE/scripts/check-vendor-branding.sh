#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PATTERN="openhands|theia|all-hands|eclipse theia|typefox"
SELF_FILE="$ROOT_DIR/scripts/check-vendor-branding.sh"

echo "Scanning product-facing docs and config for upstream branding references..."

if command -v rg >/dev/null 2>&1; then
  rg -n -i "$PATTERN" \
    "$ROOT_DIR/README.md" \
    "$ROOT_DIR/docs" \
    "$ROOT_DIR/branding" \
    "$ROOT_DIR/config" \
    "$ROOT_DIR/apps/skyequanta-shell/README.md" \
    "$ROOT_DIR/.devcontainer" \
    -g '!scripts/check-vendor-branding.sh' || true
else
  grep -RInE "$PATTERN" \
    "$ROOT_DIR/README.md" \
    "$ROOT_DIR/docs" \
    "$ROOT_DIR/branding" \
    "$ROOT_DIR/config" \
    "$ROOT_DIR/apps/skyequanta-shell/README.md" \
    "$ROOT_DIR/.devcontainer" | grep -v "$SELF_FILE" || true
fi