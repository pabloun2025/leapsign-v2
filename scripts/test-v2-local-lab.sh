#!/usr/bin/env bash
# Synthetic tests only. No production credentials, uploads or private key files.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
v2_lab_python="${V2_LAB_PYTHON:-python3}"
v2_lab_root="$PWD/v2/lab/node_modules"
v2_lab_worker="$(mktemp /tmp/leapsign-v2-worker-XXXXXX.js)"
trap 'rm -f -- "$v2_lab_worker"' EXIT
node scripts/prepare-v2-visible-engine-lab.mjs "$v2_lab_root/@libpdf/core/dist/index.mjs"
node scripts/build-v2-browser-lab.mjs \
  "$v2_lab_root/@libpdf/core/dist/leapsign-visible-lab.mjs" \
  "$v2_lab_root/qrcode/lib/browser.js" "$v2_lab_worker"
export LIBPDF_MODULE_PATH="$v2_lab_root/@libpdf/core/dist/leapsign-visible-lab.mjs"
export LIBPDF_VISIBLE_LAB=1
export QRCODE_MODULE_PATH="$v2_lab_root/qrcode/lib/index.js"
export JSQR_MODULE_PATH="$v2_lab_root/jsqr/dist/jsQR.js"
export PLAYWRIGHT_MODULE_PATH="$v2_lab_root/playwright/index.mjs"
export BROWSER_WORKER_LAB_PATH="$v2_lab_worker"
"$v2_lab_python" -m pytest validator/tests -q
