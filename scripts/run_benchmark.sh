#!/bin/sh
set -euo pipefail

# Default to mock mode unless explicitly set via args or env
MODE=${MODE:-mock}
QUERIES=${QUERIES:-10}

if [ "$MODE" = "real" ] && [ "${ALLOW_REAL_BENCH:-}" != "1" ]; then
  echo "Refusing to run in real mode without ALLOW_REAL_BENCH=1"
  exit 2
fi

node dist/scripts/generationBenchmark.js --mode=${MODE} --queries=${QUERIES}
