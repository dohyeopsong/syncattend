#!/bin/bash
# Syncattend student app — run on connected iPhone against the live backend.
# Usage: bash run_device.sh   (from anywhere)
set -e
cd "$(dirname "$0")"          # cd into mobile/
BACKEND_URL="${BACKEND_URL:-http://172.30.1.44:8000}"
echo "==> backend: $BACKEND_URL  (phone must be on the SAME Wi-Fi)"
echo "==> seed student login: student1.e2e@wku.ac.kr / seedpass123"
flutter run -d iphone \
  --dart-define=USE_MOCK=false \
  --dart-define=BACKEND_URL="$BACKEND_URL"
