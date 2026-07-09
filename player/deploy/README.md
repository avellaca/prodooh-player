# Prodooh Player - Deployment Configuration

Configuration files for deploying the Prodooh Player in kiosk mode on Raspberry Pi 5.

## Architecture

```
Raspberry Pi 5 (Raspberry Pi OS Lite + Wayland)
└── systemd
    ├── prodooh-player.service   → Cage + Chromium kiosk
    └── prodooh-player-watchdog.service → crash recovery
```

- **Cage**: Minimal Wayland compositor that runs a single app fullscreen with no window management
- **Chromium**: Browser in `--kiosk` mode displaying the player HTML bundle
- **systemd**: Service management, auto-start on boot, crash recovery

## Files

| File | Purpose |
|------|---------|
| `provision.sh` | **Automated provisioning script** (full device setup) |
| `systemd/prodooh-player.service` | Main service: Cage + Chromium kiosk |
| `systemd/prodooh-player-watchdog.service` | Watchdog: restarts player on crash |
| `systemd/prodooh-player-autologin.conf` | Auto-login for prodooh user (no manual login) |
| `cage-config.ini` | Cage compositor settings (cursor hidden, no key bindings) |
| `block-input.conf` | udev rules to block USB keyboard/mouse |
| `kiosk-lock.sh` | Enable/disable input blocking |
| `watchdog.sh` | Watchdog monitoring script |

## Requirements Covered

- **14.1**: Auto-start on boot in fullscreen without manual login
- **14.2**: Block keyboard/mouse from exiting the player
- **14.4**: Auto-restart on crash within 10 seconds
- **25.5**: Super-admin can update precargado content on newly provisioned devices

## Installation

### Automated Provisioning (Recommended)

The `provision.sh` script automates the entire setup process on a fresh Raspberry Pi OS Lite installation:

```bash
# Build the player bundle first (on your dev machine)
cd player/
npm run build

# Copy the player directory to the Raspberry Pi (via scp, USB, etc.)
scp -r . pi@<raspberry-pi-ip>:~/prodooh-player/

# SSH into the Pi and run provisioning
ssh pi@<raspberry-pi-ip>
cd ~/prodooh-player/deploy/
sudo ./provision.sh \
    --venue-id "screen-office-01" \
    --device-token "tk_abc123def456" \
    --backend-url "http://192.168.1.100:8000" \
    --prodooh-api-key "sandbox-api-key" \
    --prodooh-network-id "sandbox-network" \
    --kiosk-password "maintenance123"
```

#### Provisioning Options

| Flag | Required | Description |
|------|----------|-------------|
| `--venue-id` | Yes | Unique screen/device identifier |
| `--device-token` | Yes | Backend authentication token |
| `--backend-url` | Yes | Backend API base URL |
| `--prodooh-api-key` | No | Prodooh Ad Serving API key |
| `--prodooh-network-id` | No | Prodooh network identifier |
| `--gam-ad-tag` | No | GAM VAST sandbox tag URL |
| `--kiosk-password` | No | Password for kiosk unlock |
| `--skip-reboot` | No | Don't reboot after provisioning |
| `--force` | No | Skip confirmation prompts |

The script will reboot the device after completion. The player will start automatically on next boot in kiosk mode.

### Manual Setup Steps

If you prefer manual installation:

1. Create prodooh user and directories:

```bash
sudo useradd -m -s /bin/bash prodooh
sudo mkdir -p /opt/prodooh-player/data
sudo chown -R prodooh:prodooh /opt/prodooh-player
```

2. Copy player bundle:

```bash
sudo cp -r dist/ /opt/prodooh-player/dist/
sudo cp -r deploy/ /opt/prodooh-player/deploy/
```

3. Install systemd services:

```bash
sudo cp deploy/systemd/prodooh-player.service /etc/systemd/system/
sudo cp deploy/systemd/prodooh-player-watchdog.service /etc/systemd/system/

# Auto-login (no manual login required)
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d/
sudo cp deploy/systemd/prodooh-player-autologin.conf \
    /etc/systemd/system/getty@tty1.service.d/autologin.conf
```

4. Enable kiosk input lock:

```bash
sudo chmod +x /opt/prodooh-player/deploy/kiosk-lock.sh
sudo /opt/prodooh-player/deploy/kiosk-lock.sh enable
```

5. Enable and start services:

```bash
sudo systemctl daemon-reload
sudo systemctl enable prodooh-player.service
sudo systemctl enable prodooh-player-watchdog.service
sudo systemctl start prodooh-player.service
```

6. Reboot to verify auto-start:

```bash
sudo reboot
```

## Recovery Mechanism

The system uses a two-layer approach:

1. **systemd Restart=on-failure** (RestartSec=5s): Primary recovery mechanism
2. **Watchdog service** (3s check interval): Safety net that restarts the player service if systemd's built-in restart fails

Combined, recovery from any crash is guaranteed within 10 seconds.

## Maintenance Access

To temporarily disable kiosk lockdown for maintenance:

```bash
# Via SSH (recommended)
sudo /opt/prodooh-player/deploy/kiosk-lock.sh disable
sudo systemctl stop prodooh-player.service
# ... perform maintenance ...
sudo systemctl start prodooh-player.service
sudo /opt/prodooh-player/deploy/kiosk-lock.sh enable
```

## Cage Compositor

Cage inherently provides kiosk security by:
- Running only one application fullscreen
- Not providing window decorations or task switching
- Not exposing virtual terminal switching (Ctrl+Alt+Fx)
- Not providing any way to launch additional applications

The `block-input.conf` udev rules add defense-in-depth by preventing USB HID devices from being recognized while kiosk mode is active.
