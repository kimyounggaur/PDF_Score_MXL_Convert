#!/usr/bin/env bash
set -euo pipefail

INPUT_PDF="${1:?input PDF path is required}"
OUTPUT_DIR="${2:?output directory is required}"

mkdir -p "$OUTPUT_DIR"
audiveris -batch -transcribe -export -output "$OUTPUT_DIR" -- "$INPUT_PDF"

count="$(find "$OUTPUT_DIR" -name '*.mxl' | wc -l | tr -d ' ')"
if [ "$count" = "0" ]; then
  echo "No .mxl files were produced" >&2
  exit 2
fi
if [ "$count" != "1" ]; then
  echo "Warning: Audiveris produced $count .mxl files, likely multi-movement input." >&2
fi

find "$OUTPUT_DIR" -name '*.mxl' -print
