#!/bin/zsh
# No Fun T3 Dock launcher (installed as ~/.nofun-t3/launch.sh).
#
# Packaged app installed: make sure the CATCHES persona server is up (detached, logging to
# ~/.nofun-t3/logs/catches.log) and open /Applications/No Fun T3.app.
# Otherwise: fall back to the dev desktop app against ~/.nofun-t3-proto.
export PATH="$HOME/.local/share/vite-plus/bin:$HOME/.local/share/vite-plus/fallback-bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO="${NOFUN_T3_REPO:-$HOME/Documents/GitHub/nofunos}"
PACKAGED_APP="/Applications/No Fun T3.app"
DEV_APP="$REPO/apps/desktop/.electron-runtime/No Fun T3 (Dev).app"
LOG_DIR="$HOME/.nofun-t3/logs"
CATCHES_PORT=3791
DEV_PORT=13773

mkdir -p "$LOG_DIR"

listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

if [[ -d "$PACKAGED_APP" ]]; then
  if ! listening "$CATCHES_PORT"; then
    (cd "$REPO" && nohup node scripts/nofun/persona.ts start catches \
      >>"$LOG_DIR/catches.log" 2>&1 </dev/null &)
  fi
  open -a "$PACKAGED_APP"
  exit 0
fi

if listening "$DEV_PORT"; then
  open "$DEV_APP"
  exit 0
fi
cd "$REPO" || exit 1
nohup vp run dev:desktop --home-dir "$HOME/.nofun-t3-proto" >"$LOG_DIR/desktop.log" 2>&1 &
