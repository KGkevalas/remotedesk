#!/bin/bash
# ============================================================
#  RemoteDesk – Linux Instaliacijos Skriptas
#  Paleidimas: chmod +x install-linux.sh && ./install-linux.sh
# ============================================================

set -e

APP_NAME="RemoteDesk"
APP_VERSION="1.0.0"
INSTALL_DIR="$HOME/.local/share/remotedesk"
BIN_DIR="$HOME/.local/bin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$SCRIPT_DIR/client"

# ─── Spalvos ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

step()  { echo -e "\n${CYAN}[*] $1${NC}"; }
ok()    { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "  ${YELLOW}[!] $1${NC}"; }
fail()  { echo -e "\n${RED}[KLAIDA] $1${NC}"; exit 1; }

clear
echo -e "${BLUE}"
cat << 'EOF'
  ██████╗ ███████╗███╗   ███╗ ██████╗ ████████╗███████╗██████╗ ███████╗███████╗██╗  ██╗
  ██╔══██╗██╔════╝████╗ ████║██╔═══██╗╚══██╔══╝██╔════╝██╔══██╗██╔════╝██╔════╝██║ ██╔╝
  ██████╔╝█████╗  ██╔████╔██║██║   ██║   ██║   █████╗  ██║  ██║█████╗  ███████╗█████╔╝
  ██╔══██╗██╔══╝  ██║╚██╔╝██║██║   ██║   ██║   ██╔══╝  ██║  ██║██╔══╝  ╚════██║██╔═██╗
  ██║  ██║███████╗██║ ╚═╝ ██║╚██████╔╝   ██║   ███████╗██████╔╝███████╗███████║██║  ██╗
  ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝ ╚═════╝    ╚═╝   ╚══════╝╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝
EOF
echo -e "${NC}"
echo -e "  Nuotolinio valdymo programa v${APP_VERSION}"
echo -e "  Instaliuojama į: ${INSTALL_DIR}"
echo ""
read -p "  Spauskite ENTER tęsti..." _

# ─── 1. Sistemos priklausomybės ───────────────────────────────────────────────
step "Tikrinamos sistemos priklausomybės..."

if ! command -v curl &>/dev/null; then
    warn "curl nerastas, diegiamas..."
    sudo apt-get install -y curl 2>/dev/null || sudo dnf install -y curl 2>/dev/null || fail "Nepavyko įdiegti curl"
fi

# X11 priklausomybės ekrano fiksavimui
if command -v apt-get &>/dev/null; then
    sudo apt-get install -y -q libx11-dev libxkbfile-dev libsecret-1-dev \
        libxtst-dev libpng-dev xdotool scrot 2>/dev/null && ok "X11 priklausomybės" || warn "Kai kurios X11 priklausomybės nepridiegtos"
fi

# ─── 2. Node.js diegimas ─────────────────────────────────────────────────────
step "Tikrinamas Node.js..."

NODE_OK=false
if command -v node &>/dev/null; then
    NODE_VER=$(node -v 2>/dev/null | grep -oP '(?<=v)\d+' | head -1)
    if [ "$NODE_VER" -ge 18 ] 2>/dev/null; then
        ok "Node.js $(node -v) jau įdiegtas"
        NODE_OK=true
    else
        warn "Node.js $(node -v) per sena, reikia >= v18"
    fi
fi

if [ "$NODE_OK" = false ]; then
    step "Diegiamas Node.js v20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - 2>/dev/null
    sudo apt-get install -y nodejs 2>/dev/null || \
        (curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo dnf install -y nodejs) || \
        fail "Nepavyko įdiegti Node.js. Įdiekite rankiniu būdu: https://nodejs.org"
    ok "Node.js $(node -v) įdiegtas"
fi

# ─── 3. Sukurti instaliavimo direktoriją ──────────────────────────────────────
step "Kuriama instaliavimo direktorija..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"
ok "$INSTALL_DIR"

# ─── 4. Kopijuoti programos failus ───────────────────────────────────────────
step "Kopijuojami failai..."

if [ ! -d "$CLIENT_DIR" ]; then
    fail "Nerasta 'client' direktorija! Skriptas turi būti šalia 'client' aplanko."
fi

rsync -a --exclude='node_modules' --exclude='dist' --exclude='.git' \
    "$CLIENT_DIR/" "$INSTALL_DIR/" 2>/dev/null || \
    cp -r "$CLIENT_DIR"/* "$INSTALL_DIR/"

ok "Failai nukopijuoti"

# ─── 5. npm install ──────────────────────────────────────────────────────────
step "Diegiamos priklausomybės (npm install)..."
echo "  Tai gali užtrukti 2-5 minutes..."

cd "$INSTALL_DIR"
npm install --production 2>&1 | tail -3
ok "Priklausomybės įdiegtos"

# ─── 6. Paleidimo skriptas ────────────────────────────────────────────────────
step "Kuriami paleidimo failai..."

cat > "$BIN_DIR/remotedesk" << LAUNCH
#!/bin/bash
cd "$INSTALL_DIR"
npx electron . "\$@"
LAUNCH

chmod +x "$BIN_DIR/remotedesk"

# Patikrinti PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc" 2>/dev/null || true
    warn "Pridėtas $BIN_DIR į PATH. Atnaujinkite terminalą: source ~/.bashrc"
fi

ok "Paleidimo komanda: remotedesk"

# ─── 7. .desktop failas (GNOME / KDE) ────────────────────────────────────────
step "Kuriamas desktop įrašas..."

DESKTOP_DIR="$HOME/.local/share/applications"
mkdir -p "$DESKTOP_DIR"

cat > "$DESKTOP_DIR/remotedesk.desktop" << DESKTOP
[Desktop Entry]
Version=1.0
Type=Application
Name=RemoteDesk
Comment=Nuotolinio valdymo programa
Exec=$BIN_DIR/remotedesk
Icon=network-wired
Terminal=false
Categories=Network;RemoteAccess;
Keywords=remote;desktop;control;
DESKTOP

chmod +x "$DESKTOP_DIR/remotedesk.desktop"
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
ok "Desktop įrašas: $DESKTOP_DIR/remotedesk.desktop"

# ─── 8. Autostart (pasirinktinai) ────────────────────────────────────────────
read -p "  Ar paleisti RemoteDesk automatiškai su sistema? (t/n): " AUTOSTART
if [[ "$AUTOSTART" =~ ^[tTyY]$ ]]; then
    AUTOSTART_DIR="$HOME/.config/autostart"
    mkdir -p "$AUTOSTART_DIR"
    cp "$DESKTOP_DIR/remotedesk.desktop" "$AUTOSTART_DIR/"
    ok "Automatinis paleidimas sukonfigūruotas"
fi

# ─── 9. Atidiegimo skriptas ───────────────────────────────────────────────────
cat > "$INSTALL_DIR/uninstall.sh" << UNINSTALL
#!/bin/bash
echo "RemoteDesk atidiegimas..."
rm -rf "$INSTALL_DIR"
rm -f "$BIN_DIR/remotedesk"
rm -f "$DESKTOP_DIR/remotedesk.desktop"
rm -f "$HOME/.config/autostart/remotedesk.desktop"
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
echo "Atidiegta sėkmingai!"
UNINSTALL
chmod +x "$INSTALL_DIR/uninstall.sh"

# ─── Baigta ───────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}=================================================${NC}"
echo -e "  ${GREEN} RemoteDesk sėkmingai įdiegta!${NC}"
echo -e "  ${GREEN} Paleisti: remotedesk${NC}"
echo -e "  ${GREEN} Arba suraskite programų sąraše${NC}"
echo -e "  ${GREEN}=================================================${NC}"
echo ""

read -p "  Ar paleisti RemoteDesk dabar? (t/n): " LAUNCH_NOW
if [[ "$LAUNCH_NOW" =~ ^[tTyY]$ ]]; then
    nohup "$BIN_DIR/remotedesk" &>/dev/null &
    ok "Programa paleista!"
fi

echo ""
echo "  Atidiegimas: $INSTALL_DIR/uninstall.sh"
echo ""
