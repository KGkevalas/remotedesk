#!/bin/bash
# RemoteDesk – Linux paleidimo skriptas (be instaliacijos)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$SCRIPT_DIR/client"

cd "$CLIENT_DIR"

# Patikrinti node_modules
if [ ! -d "node_modules" ]; then
    echo "[*] Pirmasis paleidimas - diegiamos priklausomybės..."
    npm install
fi

echo "[*] Paleidžiama RemoteDesk..."
npx electron .
