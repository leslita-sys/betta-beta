#!/bin/bash
# I'M TITI — local-only server (localhost, no network exposure)
cd "$(dirname "$0")"
echo "I'M TITI running at http://localhost:4325"
python3 -m http.server 4325 --bind 127.0.0.1
