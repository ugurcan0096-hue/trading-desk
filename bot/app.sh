#!/data/data/com.termux/files/usr/bin/bash
# Memebot menu. Home-screen icon: install "Termux:Widget" from F-Droid, then run:  bash app.sh install
cd "$(dirname "$(readlink -f "$0")")" || exit 1
if [ "$1" = "install" ]; then
  mkdir -p ~/.shortcuts && ln -sf "$PWD/app.sh" ~/.shortcuts/Memebot && chmod +x app.sh
  echo "Done. Long-press your home screen -> Widgets -> Termux:Widget -> pick 'Memebot'."; exit 0
fi
termux-wake-lock 2>/dev/null
trap "true" INT   # CTRL+c stops the bot but returns to this menu
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
       echo "Mode: n) Normal (strict)   x) Aktiv (more trades, more risk)"; read -rp "n or x: " md
       if [ "$md" = "x" ]; then export MIN_LIQ_USD=10000 MIN_AGE_H=2 H1_MIN=3 H1_MAX=60 BUY_RATIO=1.05; echo "Aktiv mode."; fi
       read -rp "Dollars per trade (Enter = 4, max 8): " sz
       case "$sz" in ''|*[!0-9.]*) sz=4 ;; esac
       if python3 -c "import sys; sys.exit(0 if float('$sz') <= 8 else 1)"; then export POS_USD="$sz"; else echo "Max is 8 - using 8."; export POS_USD=8; fi
       echo "Trade size: \$$POS_USD"
       echo "a) Private key   b) Recovery phrase (12 words)"; read -rp "a or b: " kind
       if [ "$kind" = "b" ]; then
         read -rp "Wallet address (Phantom -> Erhalten -> Adresse kopieren): " WALLET_ADDRESS
         read -rsp "Paste the 12 words (hidden), then Enter: " SOLANA_PHRASE; echo
         SOLANA_PHRASE="$SOLANA_PHRASE" WALLET_ADDRESS="$WALLET_ADDRESS" LIVE=1 python3 memebot.py
       else
         read -rsp "Paste private key (hidden), then Enter: " SOLANA_PRIVATE_KEY; echo
         SOLANA_PRIVATE_KEY="$SOLANA_PRIVATE_KEY" LIVE=1 python3 memebot.py
       fi
       unset SOLANA_PRIVATE_KEY SOLANA_PHRASE MIN_LIQ_USD MIN_AGE_H H1_MIN H1_MAX BUY_RATIO POS_USD ;;
    3) tail -n 20 bot.log 2>/dev/null || echo "no log yet"; read -rp "Enter to go back" _ ;;
    4) git -C .. pull --ff-only; read -rp "Enter to go back" _ ;;
    5) rm -f STOP; [ -f state.json ] && python3 -c "
import json; s=json.load(open('state.json')); s['halted']=None; s['peak']=None; json.dump(s,open('state.json','w'),indent=1)"
       echo "Cleared."; sleep 1 ;;
    6) exit 0 ;;
  esac
done
