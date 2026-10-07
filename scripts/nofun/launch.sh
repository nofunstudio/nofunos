#!/bin/zsh
# No Fun T3 Dock launcher (installed as ~/.nofun-t3/launch.sh).
#
# Packaged app installed: make sure the CATCHES persona server is up (LaunchAgent, logging to
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

# The CATCHES server runs as a user LaunchAgent: it lives in the login session (so the keychain
# works), survives the terminal or Dock process that started it, and restarts if it crashes.
CATCHES_LABEL="io.nofun.t3.catches"
CATCHES_PLIST="$HOME/Library/LaunchAgents/$CATCHES_LABEL.plist"

# CATCHES follows the desktop app's Network access setting so phones on the LAN reach both servers.
catches_host_env() {
  grep -q '"serverExposureMode": *"network-accessible"' "$HOME/.nofun-t3/userdata/desktop-settings.json" 2>/dev/null &&
    print -r -- '<key>T3CODE_HOST</key><string>0.0.0.0</string>'
}

write_catches_agent() {
  mkdir -p "${CATCHES_PLIST:h}"
  cat >"$CATCHES_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$CATCHES_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/zsh</string><string>-c</string>
    <string>cd "$REPO" &amp;&amp; exec node scripts/nofun/persona.ts start catches</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH</string>$(catches_host_env)</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$LOG_DIR/catches.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/catches.log</string>
</dict></plist>
PLIST
}

if [[ -d "$PACKAGED_APP" ]]; then
  if ! listening "$CATCHES_PORT"; then
    write_catches_agent
    launchctl bootstrap "gui/$UID" "$CATCHES_PLIST" 2>/dev/null ||
      launchctl kickstart "gui/$UID/$CATCHES_LABEL"
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
