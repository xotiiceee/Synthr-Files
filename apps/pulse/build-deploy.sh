#!/bin/bash
# Build the polished frontend (copied from the pulse.claw-net.org deployed version) + Rust backend for VPS.
# This UI has the Chat tab, Create Agent button, Play/Pause toggles etc.
# Wires with current backend APIs.
# Run from the pulse/ root directory.
#
# After this:
#   - Copy the 'deploy/' folder contents to your VPS.
#   - On VPS: ./pulse-backend (after setting up Postgres, env, etc.)
#   - The UI served will be the polished one.

set -e

echo "=== Building polished (claw-net era) frontend + Rust backend for deploy (wired end-to-end) ==="

# 1. Build the desired frontend (the React one with create + play/pause)
echo "Building frontend (React/Vite)..."
cd frontend
pnpm install
pnpm build
cd ..

# 2. Prepare static assets for the Rust backend to serve (single binary deploy)
echo "Preparing static UI for backend..."
mkdir -p backend/static
rm -rf backend/static/*
cp -r frontend/dist/* backend/static/

# 3. Build Rust backend (release for prod)
echo "Building Rust backend..."
cd backend
cargo build --release
cd ..

# 4. Create a clean deploy bundle
echo "Creating deploy package..."
rm -rf deploy
mkdir -p deploy
cp backend/target/release/pulse-backend deploy/
cp -r backend/static deploy/
cp backend/.env.example deploy/.env.example 2>/dev/null || true
cp backend/docker-compose.yml deploy/ 2>/dev/null || true

# Copy minimal config / scripts if useful
cp PULSE_ACTUALIZATION_PLAN.md deploy/ || true
cp README.md deploy/README-deploy.md || true

echo ""
echo "=== Done! ==="
echo "The 'deploy/' directory now contains:"
echo "  - pulse-backend (the binary that serves modern UI + APIs)"
echo "  - static/ (the modern React frontend with create agent + play/pause)"
echo ""
echo "To drop on VPS:"
echo "  1. scp -r deploy/* user@vps:/home/user/pulse/"
echo "  2. On VPS: cd /home/user/pulse"
echo "  3. Setup Postgres (use the docker-compose or system Postgres)"
echo "  4. cp .env.example .env ; edit with real values (DATABASE_URL, etc.)"
echo "  5. ./pulse-backend"
echo ""
echo "The deployed app will serve the desired modern frontend (not the old one)."
echo "Key features (Create Agent, agent play/pause toggle) are wired to the backend."
echo ""
echo "For production: use a process manager (systemd), real auth, SSL, etc."
echo "See backend/README.md and the plan for details."