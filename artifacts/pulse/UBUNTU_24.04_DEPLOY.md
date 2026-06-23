# Deploying Pulse (pulse.synthr.online) on Ubuntu 24.04

This artifact (`@workspace/pulse`) is the **most complete modern version** of Pulse (extracted from the source snapshot containing the full multi-agent UI, chat-setup, Agents tab, etc.).

## Requirements on Ubuntu 24.04
- Node.js **>= 20** (Ubuntu 24.04 default repos have older Node; use NodeSource)
- pnpm (via corepack or direct install)
- nginx (or your reverse proxy) for static serving
- Build tools only if you have native deps in future (not required for this frontend)

## Quick Setup (as root or sudo)

```bash
# 1. Install Node 20 (recommended for Ubuntu 24.04)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Enable pnpm (corepack is in Node 20+)
corepack enable
corepack prepare pnpm@latest --activate

# 3. Clone / have the monorepo
cd /opt/synthr-files   # or wherever the repo lives

# 4. Install deps (workspace)
pnpm install

# 5. Build ONLY the Pulse frontend (for pulse.synthr.online)
pnpm --filter @workspace/pulse run build
```

After build, the static files are in:
`artifacts/pulse/dist/public/`

## Nginx example for pulse.synthr.online

```nginx
server {
    listen 80;
    server_name pulse.synthr.online;

    root /var/www/pulse;
    index index.html;

    location / {
        try_files $uri /index.html;   # SPA fallback (chat-setup etc.)
    }

    # Optional: cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # If you have a backend API on same host
    # location /api/ { proxy_pass http://localhost:3457; ... }
}
```

Then:

```bash
sudo mkdir -p /var/www/pulse
sudo cp -r artifacts/pulse/dist/public/* /var/www/pulse/
sudo nginx -t && sudo systemctl reload nginx
```

## Environment / Runtime Notes (Ubuntu 24.04 specific)
- OpenSSL 3.0 is default — modern Node 20+ handles it fine.
- No special flags needed for the Vite build.
- If using the full original Pulse backend (from the zip snapshot), you will also need:
  - `build-essential` `python3` for any native modules (e.g. better-sqlite3)
  - Proper .env for the hosted server
- For production, consider running the Vite preview or a proper static server behind nginx.
- The UI expects a backend at paths like `/api/...` (see original api.ts or your api-server).

## Rebuilding after changes
```bash
pnpm --filter @workspace/pulse run build
```

## Archive of older version
The previous Pulse UI is archived as `pulse-ui-old.tar.gz` at the repo root.

## Verification
After deploy, visiting https://pulse.synthr.online/ should redirect to /chat-setup and show the modern Pulse UI with multi-agent features.

Built with Node 24 in dev; target Node >=20 on Ubuntu 24.04.
