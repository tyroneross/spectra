#!/usr/bin/env bash
#
# rescue-recording.sh — recover a playable mp4 from a raw Spectra recording.
#
# The native ScreenCaptureKit recorder can emit H.264 4:4:4 (pix_fmt=gbrp),
# which QuickTime/Preview/most editors cannot decode, and occasionally leaves a
# raw file the finalize step rejected. This script re-encodes any such raw into
# a universally-playable yuv420p + faststart H.264 mp4 — the same target the
# daemon's finalize path and src/pipeline/polish.ts produce.
#
# Usage:
#   scripts/rescue-recording.sh <raw-file>            # emits <raw-file>.fixed.mp4
#   scripts/rescue-recording.sh <raw-file> <out.mp4>  # explicit output path
#   scripts/rescue-recording.sh --scale 1280 <raw>    # scale to 1280px wide (keeps aspect)
#   scripts/rescue-recording.sh <session-dir>         # rescue every raw in a session dir
#
# Options:
#   --scale <width>   Scale output to <width> px wide, height auto (even). Default: none.
#   -h, --help        Show this help.
#
# Requires: ffmpeg on PATH (brew install ffmpeg). No hardcoded ffmpeg path.
#
# SPDX-License-Identifier: Apache-2.0
# © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

set -euo pipefail

usage() {
  sed -n '3,24p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

SCALE=""
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scale)
      [[ $# -ge 2 ]] || { echo "error: --scale needs a width" >&2; exit 2; }
      SCALE="$2"; shift 2 ;;
    --scale=*)
      SCALE="${1#*=}"; shift ;;
    -h|--help) usage 0 ;;
    --) shift; while [[ $# -gt 0 ]]; do POSITIONAL+=("$1"); shift; done ;;
    -*) echo "error: unknown option $1" >&2; usage 2 ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

[[ ${#POSITIONAL[@]} -ge 1 ]] || usage 2

command -v ffmpeg >/dev/null 2>&1 || {
  echo "error: ffmpeg not found on PATH. Install with: brew install ffmpeg" >&2
  exit 1
}

# yuv420p is the load-bearing fix; +faststart moves moov to the front for streaming.
VF="format=yuv420p"
if [[ -n "$SCALE" ]]; then
  VF="scale=${SCALE}:-2,format=yuv420p"
fi

rescue_one() {
  local input="$1" output="$2"
  echo "rescue: $input -> $output"
  ffmpeg -y -i "$input" \
    -vf "$VF" \
    -c:v libx264 -crf 18 -preset veryfast \
    -movflags +faststart \
    -c:a aac \
    "$output"
  # Fail loudly if the result is a stub or lost its moov atom.
  local size
  size=$(wc -c < "$output" | tr -d ' ')
  if [[ "$size" -lt 1024 ]]; then
    echo "error: output $output is ${size} bytes (< 1KB) — rescue failed" >&2
    return 1
  fi
  echo "ok: $output (${size} bytes)"
}

SRC="${POSITIONAL[0]}"

if [[ -d "$SRC" ]]; then
  # Session-dir mode: rescue every raw recording under the directory.
  shopt -s nullglob
  found=0
  for raw in "$SRC"/*.raw.mp4 "$SRC"/*.mkv "$SRC"/*.mov; do
    [[ -e "$raw" ]] || continue
    found=1
    base="${raw%.*}"
    base="${base%.raw}"
    rescue_one "$raw" "${base}.fixed.mp4"
  done
  [[ "$found" -eq 1 ]] || { echo "error: no raw recordings (*.raw.mp4|*.mkv|*.mov) in $SRC" >&2; exit 1; }
else
  [[ -f "$SRC" ]] || { echo "error: input not found: $SRC" >&2; exit 1; }
  OUT="${POSITIONAL[1]:-}"
  if [[ -z "$OUT" ]]; then
    base="${SRC%.*}"; base="${base%.raw}"
    OUT="${base}.fixed.mp4"
  fi
  rescue_one "$SRC" "$OUT"
fi
