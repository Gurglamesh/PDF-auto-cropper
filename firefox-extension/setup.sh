#!/usr/bin/env bash
# Downloads the required JS libraries into lib/
# Run once: bash setup.sh

set -e
mkdir -p "$(dirname "$0")/lib"
cd "$(dirname "$0")/lib"

echo "Downloading pdf.min.js..."
curl -sLo pdf.min.js        "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js"

echo "Downloading pdf.worker.min.js..."
curl -sLo pdf.worker.min.js "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js"

echo "Downloading pdf-lib.min.js..."
curl -sLo pdf-lib.min.js    "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"

echo ""
echo "Done. Load in Firefox: about:debugging → This Firefox → Load Temporary Add-on → manifest.json"
