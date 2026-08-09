#!/usr/bin/env bash

if ! command -v pyftsubset &> /dev/null; then
    echo "[!] pyftsubset command not found, please install the 'fonttools' package"
    exit 1
fi

[ "$#" -ne 1 ] && echo "[?] usage: $0 <INPUT_TTF>" && exit 1

INPUT_TTF="$1"
OUTPUT_WOFF="${INPUT_TTF%.*}.woff2"

# only leaves printable ASCII, non-breaking space, & smart punctuation unicode ranges
echo "[*] ttf->woff2 & unicode stripping ..."
pyftsubset "$INPUT_TTF" \
  --output-file="$OUTPUT_WOFF" \
  --flavor=woff2 \
  --unicodes=U+0020-007E,U+00A0,U+2010-2015,U+2018-2019,U+201C-201D \
  --layout-features='*' \
  --glyph-names \
  --symbol-cmap \
  --legacy-cmap
echo "[+] wrote to $OUTPUT_WOFF"

