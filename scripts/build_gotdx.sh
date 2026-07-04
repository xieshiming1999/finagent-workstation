#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GOTDX_DIR="$APP_DIR/sidecar/gotdx"

if ! command -v go >/dev/null 2>&1; then
  echo "Go is required to build the gotdx sidecar. Install the version declared in sidecar/gotdx/go.mod, then rerun this script." >&2
  exit 1
fi

cd "$GOTDX_DIR"
go mod tidy
go build -trimpath -o gotdx-server .

echo "Built $GOTDX_DIR/gotdx-server"
