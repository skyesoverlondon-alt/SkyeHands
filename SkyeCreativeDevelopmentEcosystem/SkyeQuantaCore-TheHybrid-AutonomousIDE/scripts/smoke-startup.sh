#!/usr/bin/env bash

set -euo pipefail

BACKEND_URL="${SKYEQUANTA_BACKEND_URL:-http://127.0.0.1:3000/health}"
BRIDGE_URL="${SKYEQUANTA_BRIDGE_URL:-http://127.0.0.1:3020/api/status}"
IDE_URL="${SKYEQUANTA_IDE_URL:-http://127.0.0.1:3020}"

wait_for_url() {
	local url="$1"
	local label="$2"

	for _ in $(seq 1 60); do
		if curl -fsS "$url" >/dev/null 2>&1; then
			return 0
		fi

		sleep 1
	done

	echo "$label did not become ready: $url" >&2
	return 1
}

echo "Checking backend: $BACKEND_URL"
wait_for_url "$BACKEND_URL" 'Backend'

echo "Checking bridge: $BRIDGE_URL"
wait_for_url "$BRIDGE_URL" 'Bridge'

echo "Checking web surface: $IDE_URL"
wait_for_url "$IDE_URL" 'Web surface'

echo "SkyeQuantaCore startup smoke test passed."