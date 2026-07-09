#!/usr/bin/env bash
# Prodooh Player Watchdog Script
# Monitors the player service and restarts it if it stops unexpectedly.
# Combined with systemd's Restart=on-failure, this guarantees recovery < 10s.
#
# Requirement: 14.4 (auto-restart on crash within 10 seconds)

set -euo pipefail

SERVICE_NAME="prodooh-player.service"
CHECK_INTERVAL=3  # Check every 3 seconds
MAX_RESTART_WAIT=10  # Maximum seconds to wait before forcing restart

log() {
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [watchdog] $*"
}

log "Watchdog started for ${SERVICE_NAME}"

while true; do
    sleep "${CHECK_INTERVAL}"

    if ! systemctl is-active --quiet "${SERVICE_NAME}"; then
        log "Service ${SERVICE_NAME} is not active. Checking status..."

        STATUS=$(systemctl show "${SERVICE_NAME}" --property=ActiveState --value)
        SUBSTATE=$(systemctl show "${SERVICE_NAME}" --property=SubState --value)
        log "Current state: ${STATUS}/${SUBSTATE}"

        # If the service is not in a transitional state, restart it
        if [[ "${STATUS}" != "activating" && "${STATUS}" != "reloading" ]]; then
            log "Restarting ${SERVICE_NAME}..."
            systemctl restart "${SERVICE_NAME}" || true
            
            # Wait for service to come back up
            WAITED=0
            while ! systemctl is-active --quiet "${SERVICE_NAME}" && [[ ${WAITED} -lt ${MAX_RESTART_WAIT} ]]; do
                sleep 1
                WAITED=$((WAITED + 1))
            done

            if systemctl is-active --quiet "${SERVICE_NAME}"; then
                log "Service restarted successfully after ${WAITED}s"
            else
                log "WARNING: Service failed to restart within ${MAX_RESTART_WAIT}s"
            fi
        fi
    fi
done
