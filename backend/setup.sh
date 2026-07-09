#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Prodooh Player Backend - Local Development Setup
# ============================================================
# This script bootstraps the backend for local development:
#   1. Starts PostgreSQL via Docker Compose
#   2. Installs PHP dependencies
#   3. Configures .env for local PostgreSQL
#   4. Generates app key and JWT secret
#   5. Runs database migrations
#   6. Seeds the database (super-admin + pilot data)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# --- Pre-flight checks ---
info "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    error "Docker is required but not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
fi

if ! command -v php &> /dev/null; then
    error "PHP is required but not installed. Install PHP 8.2+."
fi

if ! command -v composer &> /dev/null; then
    error "Composer is required but not installed. Install from https://getcomposer.org/"
fi

# --- Start PostgreSQL ---
info "Starting PostgreSQL via Docker Compose..."
docker compose up -d postgres

info "Waiting for PostgreSQL to be ready..."
retries=30
until docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
    retries=$((retries - 1))
    if [ $retries -le 0 ]; then
        error "PostgreSQL did not become ready in time."
    fi
    sleep 1
done
info "PostgreSQL is ready."

# --- Install dependencies ---
if [ ! -d "vendor" ]; then
    info "Installing Composer dependencies..."
    composer install --no-interaction --prefer-dist
else
    info "Composer dependencies already installed. Skipping."
fi

# --- Configure .env ---
if [ ! -f ".env" ]; then
    info "Creating .env from .env.example..."
    cp .env.example .env
fi

# Update .env to use PostgreSQL
info "Configuring .env for local PostgreSQL..."

# Use a temporary file approach for cross-platform sed compatibility
configure_env() {
    local key="$1"
    local value="$2"
    if grep -q "^${key}=" .env; then
        # Key exists (uncommented) - update it
        sed -i.bak "s|^${key}=.*|${key}=${value}|" .env
    elif grep -q "^# *${key}=" .env; then
        # Key exists but commented - uncomment and set
        sed -i.bak "s|^# *${key}=.*|${key}=${value}|" .env
    else
        # Key doesn't exist - append
        echo "${key}=${value}" >> .env
    fi
}

configure_env "DB_CONNECTION" "pgsql"
configure_env "DB_HOST" "127.0.0.1"
configure_env "DB_PORT" "5432"
configure_env "DB_DATABASE" "prodooh_player"
configure_env "DB_USERNAME" "postgres"
configure_env "DB_PASSWORD" "secret"

# Clean up sed backup files
rm -f .env.bak

# --- Generate keys ---
if grep -q '^APP_KEY=$' .env 2>/dev/null || grep -q '^APP_KEY=base64:$' .env 2>/dev/null; then
    info "Generating application key..."
    php artisan key:generate --no-interaction
else
    info "Application key already set. Skipping."
fi

if grep -q '^JWT_SECRET=$' .env 2>/dev/null; then
    info "Generating JWT secret..."
    JWT_SECRET=$(php -r "echo bin2hex(random_bytes(32));")
    sed -i.bak "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    rm -f .env.bak
else
    info "JWT secret already set. Skipping."
fi

# --- Run migrations ---
info "Running database migrations..."
php artisan migrate --force --no-interaction

# --- Run seeders ---
info "Seeding database (super-admin + pilot data)..."
php artisan db:seed --force --no-interaction

# --- Summary ---
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN} Setup complete!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo "  PostgreSQL:  localhost:5432 (db: prodooh_player, user: postgres, pass: secret)"
echo "  Super Admin: admin@prodooh.com / password"
echo ""
echo "  Start the dev server with:"
echo "    php artisan serve"
echo ""
echo "  Stop PostgreSQL with:"
echo "    docker compose down"
echo ""
