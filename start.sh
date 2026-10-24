#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

echo
echo "Starting SIFT at http://127.0.0.1:${SIFT_PORT:-8787}"
echo "Keep this terminal open. Press Ctrl+C to stop."
echo

exec npm start
