# Prodooh Hybrid Ad Player

Monorepo for the Hybrid Ad Player system — a multi-tenant digital signage platform that replaces the licensed third-party player (Doohmain) with a custom-built solution.

## Structure

```
prodooh-player/
├── backend/       # Laravel 11 (PHP 8.4 + PostgreSQL) — Admin panel, APIs, device management
├── player/        # Vanilla TypeScript — Runs in Chromium kiosk on Raspberry Pi 5
└── contracts/     # Shared API type definitions (TypeScript interfaces + OpenAPI YAML)
```

## Components

### Backend (`/backend`)

Laravel 11 application providing:
- Multi-tenant admin panel for media owners
- Device fleet management and monitoring
- Content library and playlist management
- REST API for player device communication

**Setup:**
```bash
cd backend
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve
```

### Player (`/player`)

Vanilla TypeScript application compiled for Chromium kiosk mode on Raspberry Pi 5:
- Fixed-slot content loop engine with four sources
- Offline-first with local SQLite storage
- Seamless transitions between content pieces
- Proof of Play reporting

**Setup:**
```bash
cd player
npm install
npm run build
npm test
```

### Contracts (`/contracts`)

Shared API type definitions that define the communication contract between backend and player:
- TypeScript interfaces for all API endpoints
- OpenAPI 3.1 YAML schema for device REST API
- Types are copied (not imported) into each component to maintain deployment independence

**Check types:**
```bash
cd contracts
npm install
npm run check
```

## Architecture Principles

- **Deployment independence**: Backend and player deploy separately with no shared runtime dependencies
- **Communication via APIs only**: No shared code between backend and player; contracts define the interface
- **Offline-first player**: Player operates with local storage when backend is unreachable
- **Future separation**: Structure supports splitting into two independent repositories post-MVP

## Development

Each directory has its own dependency management:
- `backend/` — Composer (PHP)
- `player/` — npm (TypeScript)
- `contracts/` — npm (TypeScript, types only)

## Hardware Target

- **Device**: Raspberry Pi 5
- **Display**: Samsung QM65C (4K, HDMI)
- **OS**: Raspberry Pi OS Lite + Cage compositor + Chromium kiosk
- **Pilot**: 2 office totems
