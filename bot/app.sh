#!/data/data/com.termux/files/usr/bin/bash
# Memebot menu. Home-screen icon: install "Termux:Widget" from F-Droid, then run:  bash app.sh install
cd "$(dirname "$(readlink -f "$0")")" || exit 1
if [ "$1" = "install" ]; then
  mkdir -p ~/.shortcuts && ln -sf "$PWD/app.sh" ~/.shortcuts/Memebot && chmod +x app.sh
  echo "Done. Long-press your home screen -> Widgets -> Termux:Widget -> pick 'Memebot'."; exit 0
fi
termux-wake-lock 2>/dev/null
while true; do
  clear
  echo "=========== MEMEBOT ==========="
  [ -f STOP ] && echo "  (STOP file present - remove with option 5)"
  if [ -f state.json ]; then
    python3 - <<'PY'
import json; s = json.load(open("state.json"))
print(f"  Mode: {s.get('mode','?').upper()}   Halted: {s.get('halted') or 'no'}")
print(f"  Open: {', '.join(p['symbol'] for p in s['positions'].values()) or 'none'}   Closed trades: {len(s['closed'])}")
pnl = sum(t['pnl_usd'] for t in s['closed']); print(f"  Realised P&L: ${pnl:+.2f}")
PY
  fi
  echo "-------------------------------"
  echo "  1) Paper trading (fake \$13)"
  echo "  2) REAL MONEY (asks for wallet key)"
  echo "  3) Show last 20 log lines"
  echo "  4) Update bot"
  echo "  5) Clear halt / STOP"
  echo "  6) Quit"
  echo "  (while running: CTRL + c returns here)"
  read -rp "Choose: " c
  case "$c" in
    1) [ -f state.json ] && grep -q '"mode": "live"' state.json && mv state.json "state-live-$(date +%s).json"
       python3 memebot.py ;;
    2) echo "Use a NEW wallet holding only your trading money."
       read -rp "Type LIVE to confirm real-money trading: " ok; [ "$ok" = "LIVE" ] || continue
       python3 -c "import cryptography" 2>/dev/null || python3 -c "import nacl" 2>/dev/null || pkg install -y python-cryptography
       [ -f state.json ] && grep -q '"mode": "dry"' state.json && mv state.json "state-dry-$(date +%s).json"
       read -rsp "Paste private key (hidden), then Enter: " SOLANA_PRIVATE_KEY; echo
       SOLANA_PRIVATE_KEY="$SOLANA_PRIVATE_KEY" LIVE=1 python3 memebot.py
       unset SOLANA_PRIVATE_KEY ;;
    3) tail -n 20 bot.log 2>/dev/null || echo "no log yet"; read -rp "Enter to go back" _ ;;
    4) git -C .. pull --ff-only; read -rp "Enter to go back" _ ;;
    5) rm -f STOP; [ -f state.json ] && python3 -c "
import json; s=json.load(open('state.json')); s['halted']=None; s['peak']=None; json.dump(s,open('state.json','w'),indent=1)"
       echo "Cleared."; sleep 1 ;;
    6) exit 0 ;;
  esac
done
