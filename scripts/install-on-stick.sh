#!/usr/bin/env bash
# Installs Thalco TV on a Fire TV Stick 4K Select from Ubuntu, including
# Ubuntu running on Windows (WSL). It asks for what it needs as it goes.
#
#   bash install-on-stick.sh [path/to/thalcotv_armv7.vpkg]
#
# Before starting, have a free Amazon Developer account
# (https://developer.amazon.com) and the stick on the same Wi-Fi or network
# as this computer.

set -euo pipefail

APP=com.thalco.tv.main
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ask() { local a; read -r -p "$1 " a; printf '%s' "$a"; }

# 1. Find the package: the argument, this folder, or the Windows Downloads folder.
PKG="${1:-}"
if [ -z "$PKG" ]; then
  PKG=$(ls -t ./thalcotv_armv7*.vpkg "$HOME"/thalcotv_armv7*.vpkg \
    "$HOME"/Downloads/thalcotv_armv7*.vpkg \
    /mnt/c/Users/*/Downloads/thalcotv_armv7*.vpkg 2>/dev/null | head -n 1 || true)
fi
if [ -z "$PKG" ] || [ ! -f "$PKG" ]; then
  echo "Could not find thalcotv_armv7.vpkg."
  echo "Save it in your Windows Downloads folder, or pass its path:"
  echo "  bash install-on-stick.sh /path/to/thalcotv_armv7.vpkg"
  exit 1
fi
say "Package: $PKG"

# 2. Amazon's Vega tools (skipped when already installed).
if [ ! -f "$HOME/vega/env" ]; then
  say "Installing Amazon's Vega tools (a few minutes, asks for your password once)"
  sudo apt-get update
  sudo apt-get install -y curl jq lz4
  NONINTERACTIVE=true SKIP_VVD_INSTALL=true \
    bash -c 'curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash'
fi
# shellcheck disable=SC1091
set +u; source "$HOME/vega/env"; set -u
vega --version

# 3. Developer Mode on the stick.
say "Developer Mode"
cat <<'EOF'
On the stick:
  a. Settings > My Fire TV > About. Highlight the device name and press
     Select seven times, until "You are now a developer" appears.
  b. Back, then Developer Options > Developer Mode > Continue.
     A 6-digit code appears. It is valid for 5 minutes.
EOF
if [ "$(ask 'Is Developer Mode already on from an earlier install? [y/N]')" != "y" ]; then
  echo "Signing in to your Amazon Developer account."
  echo "If a web address is printed, open it in your Windows browser."
  vega devmode login
  CODE=$(ask "6-digit code shown on the TV:")
  vega devmode enable-device --code "$CODE"
  echo "The stick restarts now. Wait until it is back on the home screen."
  ask "Press Enter when it is." >/dev/null
fi

# 4. Network connection.
say "Connection"
cat <<'EOF'
On the stick:
  a. Settings > My Fire TV > Developer Options > Connection Mode > TCP/IP,
     then "Use standard port 5555". The stick restarts.
  b. Settings > My Fire TV > About > Network shows its IP address.
EOF
IP=$(ask "IP address of the stick (for example 192.168.1.50):")
vega exec vda connect "$IP:5555"
vega device list

# 5. Install and start.
say "Installing Thalco TV"
vega device install-app --packagePath "$PKG"
vega device launch-app --appName "$APP"

say "Done. Thalco TV is on the stick's home screen."
echo "Next, on the TV: Settings > Add-ons, and install a stream add-on."
