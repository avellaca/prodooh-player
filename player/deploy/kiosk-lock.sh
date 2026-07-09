#!/usr/bin/env bash
# Prodooh Player Kiosk Lock Manager
# Enables/disables the kiosk input blocking rules.
#
# Usage:
#   kiosk-lock.sh enable   - Activate kiosk lockdown (block keyboard/mouse)
#   kiosk-lock.sh disable  - Deactivate lockdown (allow input for maintenance)
#
# Requirement: 14.2 (block keyboard/mouse in kiosk mode)

set -euo pipefail

RULES_FILE="/etc/udev/rules.d/99-prodooh-kiosk-block-input.rules"
SOURCE_RULES="/opt/prodooh-player/deploy/block-input.conf"
ENV_FILE="/etc/environment.d/prodooh-kiosk.conf"

log() {
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [kiosk-lock] $*"
}

enable_lock() {
    log "Enabling kiosk input lock..."

    # Set environment variable for udev rules
    mkdir -p /etc/environment.d
    echo "PRODOOH_KIOSK_LOCKED=1" > "${ENV_FILE}"

    # Install udev rules
    cp "${SOURCE_RULES}" "${RULES_FILE}"
    udevadm control --reload-rules
    udevadm trigger

    log "Kiosk lock enabled. Keyboard and mouse input blocked."
}

disable_lock() {
    log "Disabling kiosk input lock..."

    # Remove environment variable
    rm -f "${ENV_FILE}"

    # Remove udev rules
    rm -f "${RULES_FILE}"
    udevadm control --reload-rules
    udevadm trigger

    log "Kiosk lock disabled. Keyboard and mouse input allowed."
}

case "${1:-}" in
    enable)
        enable_lock
        ;;
    disable)
        disable_lock
        ;;
    *)
        echo "Usage: $0 {enable|disable}"
        exit 1
        ;;
esac
