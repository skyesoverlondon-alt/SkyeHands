#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "System dependency bootstrap is only automated for Linux." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "apt-get is required for this setup script." >&2
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required for this setup script." >&2
  exit 1
fi

if ! sudo apt-get update; then
  if [[ -f /etc/apt/sources.list.d/yarn.list ]]; then
    echo "Disabling broken Yarn apt source and retrying update..."
    sudo mv /etc/apt/sources.list.d/yarn.list /etc/apt/sources.list.d/yarn.list.disabled
    sudo apt-get update
  else
    exit 1
  fi
fi

sudo apt-get install -y build-essential pkg-config libxkbfile-dev libsecret-1-dev