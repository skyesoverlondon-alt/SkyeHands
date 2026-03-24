#!/usr/bin/env bash

set -euo pipefail

if command -v poetry >/dev/null 2>&1; then
  echo "Poetry is already installed."
  exit 0
fi

PYTHON_BIN=""
for candidate in python3.12 python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    PYTHON_BIN="$candidate"
    break
  fi
done

if [[ -z "$PYTHON_BIN" ]]; then
  echo "Unable to install Poetry: no python interpreter was found." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Unable to install Poetry: curl is required." >&2
  exit 1
fi

curl -sSL https://install.python-poetry.org | "$PYTHON_BIN" -
echo "Poetry installed to $HOME/.local/bin"