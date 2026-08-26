#!/usr/bin/env bash
# Build the macOS desktop app end to end: python venv, frozen PyInstaller
# sidecar, smoke test, then the Electron dmg. Run ON a Mac (Intel or Apple
# Silicon; the build is native to the machine's own arch), from anywhere:
# paths are script-relative. Prereqs once: Xcode Command Line Tools
# (xcode-select --install), python3 3.10+, node 20+.
#
# The brue and brue-connect SIBLING CLONES ARE REQUIRED next to this repo:
#   <parent>/lse-terminal  <parent>/brue  <parent>/brue-connect
# pyproject depends on "brue-lang", which is NOT on PyPI yet; installing the
# app without the sibling first would make pip ask the public index for it
# (and the bare "brue" name there is a stranger's package). The
# siblings are installed FIRST so pip sees the dependency satisfied and
# never asks PyPI for it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESK="$ROOT/desktop"
VENV="$ROOT/.venv"
PORT="${LSE_SMOKE_PORT:-7897}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "this script builds the macOS app; run it on the Mac" >&2
  exit 1
fi

for sib in brue brue-connect; do
  if [ ! -f "$ROOT/../$sib/pyproject.toml" ]; then
    echo "missing sibling clone ../$sib; clone it next to lse-terminal first" >&2
    exit 1
  fi
done

echo "== python venv"
# Check the interpreter BEFORE building a venv from it. A stock Mac resolves
# python3 to the Command Line Tools shim, which is 3.9; this project and
# brue-connect both declare requires-python >= 3.10, so a venv built on the
# shim fails several steps later inside pip with a message that says nothing
# about which python was wrong. PYTHON=/path/to/python3 overrides.
PY="${PYTHON:-python3}"
if [ ! -x "$VENV/bin/python" ]; then
  for cand in "$PY" /opt/homebrew/bin/python3 /usr/local/bin/python3; do
    command -v "$cand" >/dev/null 2>&1 || continue
    if "$cand" -c 'import sys; sys.exit(0 if sys.version_info[:2] >= (3, 10) else 1)' 2>/dev/null; then
      PY="$cand"; break
    fi
  done
  if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info[:2] >= (3, 10) else 1)' 2>/dev/null; then
    echo "python 3.10+ required; '$PY' is $("$PY" -V 2>&1). Install one" >&2
    echo "(brew install python) or set PYTHON=/path/to/python3 and rerun." >&2
    exit 1
  fi
  echo "   using $PY ($("$PY" -V 2>&1))"
  "$PY" -m venv "$VENV"
fi
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -e "$ROOT/../brue" -e "$ROOT/../brue-connect"
"$VENV/bin/pip" install --quiet -e "$ROOT" pyinstaller

echo "== frozen sidecar (PyInstaller onedir)"
# --clean AND a deleted workpath: a plain rebuild reuses the cached Analysis
# and can keep a stale PYZ (this bit the Windows build once); never trust the cache.
rm -rf "$DESK/pyi-work" "$DESK/pyi-dist" "$DESK/sidecar/lset-server"
"$VENV/bin/pyinstaller" --noconfirm --clean \
  --workpath "$DESK/pyi-work" --distpath "$DESK/pyi-dist" \
  "$DESK/pyi-spec/lset-server.spec"
mkdir -p "$DESK/sidecar"
cp -R "$DESK/pyi-dist/lset-server" "$DESK/sidecar/lset-server"

echo "== smoke test on :$PORT"
"$DESK/sidecar/lset-server/lset-server" --no-browser --port "$PORT" \
  > "$DESK/pyi-dist/smoke.log" 2>&1 &
SMOKE_PID=$!
trap 'kill "$SMOKE_PID" 2>/dev/null || true' EXIT
ok=""
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  # a sidecar that already died never becomes healthy; fail fast with its log
  kill -0 "$SMOKE_PID" 2>/dev/null || break
  sleep 1
done
if [ -z "$ok" ]; then
  echo "sidecar failed the smoke test; tail of smoke.log:" >&2
  tail -40 "$DESK/pyi-dist/smoke.log" >&2
  exit 1
fi
kill "$SMOKE_PID" 2>/dev/null || true
trap - EXIT
echo "smoke OK"

echo "== electron app (dmg + zip)"
cd "$DESK"
npm install
# Release channel. LSE_CHANNEL=dev builds an INTERNAL app whose updater reads
# an internal release channel instead of the public one, so a build can be
# exercised on the dev channel before it is promoted to the public feed. The
# channel URL and token come from ~/.private_keys/devfeed.env (DEV_FEED_URL,
# DEV_FEED_TOKEN), never the repo; the token is sent as a request header whose
# value must contain no space (electron-builder's command line splits the
# value at the space and drops the secret).
EB_ARGS=()
if [ "${LSE_CHANNEL:-}" = "dev" ]; then
  DEVFEED="$HOME/.private_keys/devfeed.env"
  [ -f "$DEVFEED" ] || { echo "LSE_CHANNEL=dev needs $DEVFEED" >&2; exit 1; }
  # shellcheck disable=SC1090
  . "$DEVFEED"
  EB_ARGS+=("-c.publish.url=$DEV_FEED_URL" "-c.publish.requestHeaders.X-LSE-Feed=$DEV_FEED_TOKEN")
  echo "   channel: dev (private shelf)"
else
  echo "   channel: public"
fi
# Sign + notarize when the machine carries the Developer ID identity AND an
# App Store Connect API key (notarytool); otherwise build unsigned so a Mac
# without the credentials still produces a testable dmg (first launch then
# needs Privacy & Security, Open Anyway). The key file is the standard
# notarytool location; electron-builder passes it to @electron/notarize via
# APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER. Key id and issuer
# live in ~/.private_keys/notary.env (KEY_ID=..., ISSUER_ID=...), never in
# the repo.
NOTARY_ENV="$HOME/.private_keys/notary.env"
if security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application" && [ -f "$NOTARY_ENV" ]; then
  # shellcheck disable=SC1090
  . "$NOTARY_ENV"
  export APPLE_API_KEY="$HOME/.private_keys/AuthKey_${KEY_ID}.p8"
  export APPLE_API_KEY_ID="$KEY_ID"
  export APPLE_API_ISSUER="$ISSUER_ID"
  if [ ! -f "$APPLE_API_KEY" ]; then echo "notary key $APPLE_API_KEY missing" >&2; exit 1; fi
  echo "   signing with Developer ID and notarizing (team T9GM7MY6B8)"
  npx electron-builder --mac ${EB_ARGS[@]+"${EB_ARGS[@]}"}
else
  echo "   no Developer ID identity + notary key on this Mac: unsigned build"
  CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac ${EB_ARGS[@]+"${EB_ARGS[@]}"}
fi
# Say the architecture out loud. The frozen sidecar is a native Mach-O and
# PyInstaller cannot produce a universal one, so this dmg runs ONLY on Macs
# of the arch that built it: an Apple Silicon build will not open on an
# Intel Mac, and vice versa. Shipping both means running this on both.
echo "done ($(uname -m) only):"
ls -d "$DESK"/dist/*.dmg "$DESK"/dist/*.zip 2>/dev/null || echo "  (see $DESK/dist)"
