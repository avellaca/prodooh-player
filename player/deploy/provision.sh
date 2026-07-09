#!/usr/bin/env bash
# =============================================================================
# Prodooh Player - Raspberry Pi Provisioning Script
# =============================================================================
# Automates full setup of a fresh Raspberry Pi OS Lite device for kiosk playback.
#
# This script:
#   1. Installs system dependencies (Cage compositor, Chromium, SQLite)
#   2. Creates the prodooh user and directory structure
#   3. Deploys the player bundle to /opt/prodooh-player/
#   4. Installs and enables systemd services (player + watchdog)
#   5. Configures auto-login for headless kiosk boot
#   6. Sets up initial device config (venue_id, device_token, backend_url)
#   7. Enables kiosk input lock
#
# Usage:
#   sudo ./provision.sh --venue-id <ID> --device-token <TOKEN> --backend-url <URL> [OPTIONS]
#
# Requirements: 14.1, 14.4, 25.5
# =============================================================================

set -euo pipefail

# =============================================================================
# Configuration defaults
# =============================================================================
INSTALL_DIR="/opt/prodooh-player"
DATA_DIR="${INSTALL_DIR}/data"
CONFIG_DB="${DATA_DIR}/player.db"
PRODOOH_USER="prodooh"
PRODOOH_UID=1000

# Script directory (where this script resides alongside the bundle)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Player root is one level up from deploy/
PLAYER_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# =============================================================================
# Color output helpers
# =============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# =============================================================================
# Parse command-line arguments
# =============================================================================
VENUE_ID=""
DEVICE_TOKEN=""
BACKEND_URL=""
PRODOOH_API_KEY=""
PRODOOH_NETWORK_ID=""
GAM_AD_TAG=""
KIOSK_PASSWORD=""
SKIP_REBOOT=false
FORCE=false

usage() {
    cat <<EOF
Usage: sudo $0 [OPTIONS]

Required:
  --venue-id <ID>          Unique identifier for this screen/device
  --device-token <TOKEN>   Authentication token for backend communication
  --backend-url <URL>      Backend API base URL (e.g., https://player.prodooh.com)

Optional:
  --prodooh-api-key <KEY>      Prodooh Ad Serving API key
  --prodooh-network-id <ID>    Prodooh network identifier
  --gam-ad-tag <TAG>           Google Ad Manager VAST sandbox tag URL
  --kiosk-password <PASS>      Password for kiosk unlock (maintenance access)
  --skip-reboot                Don't reboot after provisioning
  --force                      Skip confirmation prompts
  -h, --help                   Show this help message

Example:
  sudo ./provision.sh \\
    --venue-id "screen-office-01" \\
    --device-token "tk_abc123def456" \\
    --backend-url "http://192.168.1.100:8000" \\
    --prodooh-api-key "sandbox-api-key" \\
    --prodooh-network-id "sandbox-network"
EOF
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --venue-id)       VENUE_ID="$2"; shift 2 ;;
        --device-token)   DEVICE_TOKEN="$2"; shift 2 ;;
        --backend-url)    BACKEND_URL="$2"; shift 2 ;;
        --prodooh-api-key)    PRODOOH_API_KEY="$2"; shift 2 ;;
        --prodooh-network-id) PRODOOH_NETWORK_ID="$2"; shift 2 ;;
        --gam-ad-tag)     GAM_AD_TAG="$2"; shift 2 ;;
        --kiosk-password) KIOSK_PASSWORD="$2"; shift 2 ;;
        --skip-reboot)    SKIP_REBOOT=true; shift ;;
        --force)          FORCE=true; shift ;;
        -h|--help)        usage ;;
        *) log_error "Unknown option: $1"; usage ;;
    esac
done

# Validate required arguments
if [[ -z "${VENUE_ID}" ]]; then
    log_error "Missing required argument: --venue-id"
    usage
fi
if [[ -z "${DEVICE_TOKEN}" ]]; then
    log_error "Missing required argument: --device-token"
    usage
fi
if [[ -z "${BACKEND_URL}" ]]; then
    log_error "Missing required argument: --backend-url"
    usage
fi

# =============================================================================
# Pre-flight checks
# =============================================================================
if [[ $EUID -ne 0 ]]; then
    log_error "This script must be run as root (use sudo)"
    exit 1
fi

if [[ ! -d "${PLAYER_ROOT}/dist" ]]; then
    log_error "Player bundle not found at ${PLAYER_ROOT}/dist/"
    log_error "Run 'npm run build' in the player directory first."
    exit 1
fi

log_info "============================================"
log_info " Prodooh Player - Raspberry Pi Provisioning"
log_info "============================================"
log_info ""
log_info "Configuration:"
log_info "  Venue ID:      ${VENUE_ID}"
log_info "  Backend URL:   ${BACKEND_URL}"
log_info "  Device Token:  ${DEVICE_TOKEN:0:8}..."
log_info "  Install Dir:   ${INSTALL_DIR}"
[[ -n "${PRODOOH_API_KEY}" ]] && log_info "  Prodooh API:   configured"
[[ -n "${GAM_AD_TAG}" ]]      && log_info "  GAM VAST:      configured"
log_info ""

if [[ "${FORCE}" != "true" ]]; then
    read -rp "Proceed with provisioning? [y/N] " confirm
    if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
        log_info "Aborted."
        exit 0
    fi
fi

# =============================================================================
# Step 1: Install system dependencies
# =============================================================================
log_info "Step 1/7: Installing system dependencies..."

apt-get update -qq

# Core packages for Cage + Chromium kiosk mode
apt-get install -y --no-install-recommends \
    cage \
    chromium-browser \
    sqlite3 \
    libsqlite3-dev \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libinput10 \
    libegl1 \
    libgles2 \
    mesa-utils \
    xdg-utils \
    dbus \
    > /dev/null 2>&1

log_ok "System dependencies installed"

# =============================================================================
# Step 2: Create prodooh user and directory structure
# =============================================================================
log_info "Step 2/7: Setting up user and directories..."

# Create prodooh user if it doesn't exist
if ! id "${PRODOOH_USER}" &>/dev/null; then
    useradd -m -s /bin/bash -u "${PRODOOH_UID}" "${PRODOOH_USER}"
    log_ok "Created user: ${PRODOOH_USER}"
else
    log_warn "User ${PRODOOH_USER} already exists, skipping creation"
fi

# Create directory structure
mkdir -p "${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}/dist"
mkdir -p "${INSTALL_DIR}/deploy"
mkdir -p "${INSTALL_DIR}/deploy/systemd"
mkdir -p "${DATA_DIR}"
mkdir -p "${DATA_DIR}/cache"
mkdir -p "${DATA_DIR}/factory"

# Create XDG_RUNTIME_DIR for the prodooh user (needed for Wayland/Cage)
mkdir -p "/run/user/${PRODOOH_UID}"
chown "${PRODOOH_USER}:${PRODOOH_USER}" "/run/user/${PRODOOH_UID}"
chmod 700 "/run/user/${PRODOOH_UID}"

log_ok "Directory structure created"

# =============================================================================
# Step 3: Deploy player bundle
# =============================================================================
log_info "Step 3/7: Deploying player bundle..."

# Copy the built player application
cp -r "${PLAYER_ROOT}/dist/"* "${INSTALL_DIR}/dist/"

# Copy deploy configuration files
cp "${SCRIPT_DIR}/cage-config.ini" "${INSTALL_DIR}/deploy/"
cp "${SCRIPT_DIR}/block-input.conf" "${INSTALL_DIR}/deploy/"
cp "${SCRIPT_DIR}/kiosk-lock.sh" "${INSTALL_DIR}/deploy/"
cp "${SCRIPT_DIR}/watchdog.sh" "${INSTALL_DIR}/deploy/"

# Copy factory/precargado content (branding animations)
if [[ -d "${PLAYER_ROOT}/public/factory" ]]; then
    cp -r "${PLAYER_ROOT}/public/factory/"* "${DATA_DIR}/factory/"
    log_ok "Factory content deployed"
else
    log_warn "No factory content found at ${PLAYER_ROOT}/public/factory/"
fi

# Set permissions
chown -R "${PRODOOH_USER}:${PRODOOH_USER}" "${INSTALL_DIR}"
chmod +x "${INSTALL_DIR}/deploy/kiosk-lock.sh"
chmod +x "${INSTALL_DIR}/deploy/watchdog.sh"

log_ok "Player bundle deployed to ${INSTALL_DIR}"

# =============================================================================
# Step 4: Configure systemd services (player + watchdog)
# =============================================================================
log_info "Step 4/7: Installing systemd services..."

# Install main player service
cp "${SCRIPT_DIR}/systemd/prodooh-player.service" /etc/systemd/system/
# Install watchdog service
cp "${SCRIPT_DIR}/systemd/prodooh-player-watchdog.service" /etc/systemd/system/

# Install auto-login override for getty
mkdir -p /etc/systemd/system/getty@tty1.service.d/
cp "${SCRIPT_DIR}/systemd/prodooh-player-autologin.conf" \
    /etc/systemd/system/getty@tty1.service.d/autologin.conf

# Reload systemd to pick up new units
systemctl daemon-reload

# Enable services for boot
systemctl enable prodooh-player.service
systemctl enable prodooh-player-watchdog.service

log_ok "Systemd services installed and enabled"

# =============================================================================
# Step 5: Set up initial device configuration
# =============================================================================
log_info "Step 5/7: Configuring device identity..."

# Initialize the SQLite config database with device credentials
# The player reads these on startup for authentication and source configuration
sqlite3 "${CONFIG_DB}" <<SQL
CREATE TABLE IF NOT EXISTS device_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT OR REPLACE INTO device_config (key, value, updated_at)
VALUES
    ('venue_id', '${VENUE_ID}', datetime('now')),
    ('device_token', '${DEVICE_TOKEN}', datetime('now')),
    ('backend_url', '${BACKEND_URL}', datetime('now'));
SQL

# Add optional Prodooh API credentials
if [[ -n "${PRODOOH_API_KEY}" ]]; then
    sqlite3 "${CONFIG_DB}" <<SQL
INSERT OR REPLACE INTO device_config (key, value, updated_at)
VALUES ('prodooh_api_key', '${PRODOOH_API_KEY}', datetime('now'));
SQL
fi

if [[ -n "${PRODOOH_NETWORK_ID}" ]]; then
    sqlite3 "${CONFIG_DB}" <<SQL
INSERT OR REPLACE INTO device_config (key, value, updated_at)
VALUES ('prodooh_network_id', '${PRODOOH_NETWORK_ID}', datetime('now'));
SQL
fi

# Add optional GAM ad tag
if [[ -n "${GAM_AD_TAG}" ]]; then
    sqlite3 "${CONFIG_DB}" <<SQL
INSERT OR REPLACE INTO device_config (key, value, updated_at)
VALUES ('gam_ad_tag', '${GAM_AD_TAG}', datetime('now'));
SQL
fi

# Set kiosk password (hashed, not plaintext) — Requirement 14.5
if [[ -n "${KIOSK_PASSWORD}" ]]; then
    KIOSK_HASH=$(echo -n "${KIOSK_PASSWORD}" | sha256sum | cut -d' ' -f1)
    sqlite3 "${CONFIG_DB}" <<SQL
INSERT OR REPLACE INTO device_config (key, value, updated_at)
VALUES ('kiosk_password_hash', '${KIOSK_HASH}', datetime('now'));
SQL
    log_ok "Kiosk password configured (stored as SHA-256 hash)"
fi

# Set ownership on the config database
chown "${PRODOOH_USER}:${PRODOOH_USER}" "${CONFIG_DB}"
chmod 600 "${CONFIG_DB}"

log_ok "Device configuration written to ${CONFIG_DB}"

# =============================================================================
# Step 6: Enable kiosk input lock
# =============================================================================
log_info "Step 6/7: Enabling kiosk input lock..."

"${INSTALL_DIR}/deploy/kiosk-lock.sh" enable

log_ok "Kiosk input lock enabled"

# =============================================================================
# Step 7: Final system configuration
# =============================================================================
log_info "Step 7/7: Applying final system settings..."

# Disable screen blanking/DPMS (prevent display from sleeping)
mkdir -p /etc/profile.d/
cat > /etc/profile.d/prodooh-no-blank.sh <<'PROFILE'
# Disable screen blanking for Prodooh Player kiosk mode
export DISPLAY=:0
xset -dpms 2>/dev/null || true
xset s off 2>/dev/null || true
PROFILE

# Set up tmpfiles.d to recreate XDG_RUNTIME_DIR on boot
cat > /etc/tmpfiles.d/prodooh-runtime.conf <<TMPFILES
d /run/user/${PRODOOH_UID} 0700 ${PRODOOH_USER} ${PRODOOH_USER} -
TMPFILES

# Ensure dbus is running (required by Chromium)
systemctl enable dbus

# Optimize GPU memory split for media playback (Raspberry Pi specific)
if [[ -f /boot/config.txt ]]; then
    if ! grep -q "gpu_mem=" /boot/config.txt; then
        echo "# Prodooh Player: Increase GPU memory for 4K video decode" >> /boot/config.txt
        echo "gpu_mem=256" >> /boot/config.txt
        log_ok "GPU memory set to 256MB in /boot/config.txt"
    fi
elif [[ -f /boot/firmware/config.txt ]]; then
    if ! grep -q "gpu_mem=" /boot/firmware/config.txt; then
        echo "# Prodooh Player: Increase GPU memory for 4K video decode" >> /boot/firmware/config.txt
        echo "gpu_mem=256" >> /boot/firmware/config.txt
        log_ok "GPU memory set to 256MB in /boot/firmware/config.txt"
    fi
fi

log_ok "System configuration applied"

# =============================================================================
# Summary
# =============================================================================
echo ""
log_info "============================================"
log_ok   " Provisioning complete!"
log_info "============================================"
echo ""
log_info "Device Summary:"
log_info "  Venue ID:        ${VENUE_ID}"
log_info "  Backend URL:     ${BACKEND_URL}"
log_info "  Install Path:    ${INSTALL_DIR}"
log_info "  Config DB:       ${CONFIG_DB}"
log_info "  Player Service:  prodooh-player.service"
log_info "  Watchdog:        prodooh-player-watchdog.service"
echo ""
log_info "Services enabled:"
log_info "  - prodooh-player.service (Cage + Chromium kiosk)"
log_info "  - prodooh-player-watchdog.service (crash recovery)"
log_info "  - Auto-login via getty@tty1 override"
echo ""
log_info "Maintenance access:"
log_info "  SSH is recommended for remote management"
log_info "  Kiosk lock can be toggled: ${INSTALL_DIR}/deploy/kiosk-lock.sh {enable|disable}"
echo ""

if [[ "${SKIP_REBOOT}" == "true" ]]; then
    log_warn "Skipping reboot (--skip-reboot). Reboot manually to start kiosk mode."
    log_info "  sudo reboot"
else
    log_info "Rebooting in 5 seconds to start kiosk mode..."
    log_info "Press Ctrl+C to cancel."
    sleep 5
    reboot
fi
