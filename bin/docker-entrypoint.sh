#!/usr/bin/env bash
set -euo pipefail

# This entrypoint enables headful Chrome/Firefox/WebKit via VNC when requested
# and dispatches to either the serp CLI or serp-bench.
# Headful triggers when either:
#  - HEADFUL env var is set to 1/true/yes
#  - '--headful' is present in CLI args

is_true() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0;;
    *) return 1;;
  esac
}

args_has_headful=false
for a in "$@"; do
  if [[ "$a" == "--headful" ]]; then
    args_has_headful=true
    break
  fi
done

headful=false
if is_true "${HEADFUL:-}" || [[ "$args_has_headful" == true ]]; then
  headful=true
fi

cleanup() {
  # Best-effort cleanup of background processes
  pkill -P $$ || true
}
trap cleanup EXIT

if [[ "$headful" == true ]]; then
  : "${DISPLAY:=:99}"
  : "${SCREEN_WIDTH:=1920}"
  : "${SCREEN_HEIGHT:=1080}"
  : "${SCREEN_DEPTH:=24}"
  : "${VNC_PORT:=5900}"

  echo "[entrypoint] Starting virtual display at ${DISPLAY} (${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH})"
  Xvfb "${DISPLAY}" -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" -ac +extension RANDR >/tmp/xvfb.log 2>&1 &

  # A lightweight window manager helps some apps behave predictably
  fluxbox >/tmp/fluxbox.log 2>&1 &

  # Configure VNC auth if password provided
  VNC_AUTH_ARGS="-nopw"
  if [[ -n "${VNC_PASSWORD:-}" ]]; then
    echo "[entrypoint] Configuring VNC password auth"
    x11vnc -storepasswd "${VNC_PASSWORD}" /tmp/x11vnc.pass >/dev/null 2>&1 || true
    VNC_AUTH_ARGS="-rfbauth /tmp/x11vnc.pass"
  fi

  echo "[entrypoint] Starting VNC server on port ${VNC_PORT}"
  # -forever: keep accepting new connections; -shared: allow multiple clients
  x11vnc -display "${DISPLAY}" ${VNC_AUTH_ARGS} -forever -shared -rfbport "${VNC_PORT}" -quiet >/tmp/x11vnc.log 2>&1 &

  # Give Xvfb/VNC a moment to be ready
  sleep 0.5
fi

# Subcommand dispatch: default to serp, allow 'serp', 'serp-bench' or 'bench'
target="serp"
if [[ "${1:-}" == "serp" ]]; then
  shift
  target="serp"
elif [[ "${1:-}" == "serp-bench" || "${1:-}" == "bench" ]]; then
  shift
  target="bench"
fi

if [[ "$target" == "bench" ]]; then
  exec node /app/dist/bench.js "$@"
else
  exec node /app/dist/cli.js "$@"
fi
