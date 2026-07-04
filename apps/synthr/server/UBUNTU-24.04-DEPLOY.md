# Ubuntu 24.04 VPS Deployment

This guide is the concrete Ubuntu 24.04 path that follows the project roadmap: validate locally, deploy to VPS with Docker, then put Caddy in front for HTTPS.

## 1. Prepare Ubuntu 24.04

SSH into the VPS and install the base packages:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git
```

Install Docker Engine and the Compose plugin:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and back in after adding yourself to the `docker` group.

## 2. Clone And Configure

```bash
git clone YOUR_REPO_URL synthr-tools
cd synthr-tools/server
cp .env.example .env
```

Edit `.env` for Ubuntu testnet deployment first:

```dotenv
PAY_TO_ADDRESS=0xYourRealWalletAddress
FACILITATOR_URL=https://x402.org/facilitator
NETWORK=eip155:84532
DEFAULT_PRICE_USD=0.005
BIND_HOST=127.0.0.1
CORS_ORIGIN=https://yourdomain.com
PUBLIC_BASE_URL=https://synthr.online
PORT=3000
LOG_LEVEL=info
```

Notes:
- Keep `BIND_HOST=127.0.0.1` when using Caddy on the same VPS.
- Stay on Base Sepolia until the public payment flow works end to end.
- Only switch to `NETWORK=eip155:8453` after testnet validation.

## 3. Build And Run

```bash
docker compose up -d --build
docker logs synthr-cyber --tail 100
curl http://127.0.0.1:3000/health
```

Verify discovery locally on the box:

```bash
curl http://127.0.0.1:3000/
curl http://127.0.0.1:3000/llms.txt
curl http://127.0.0.1:3000/x402-catalog.json
```

## 4. Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Copy [Caddyfile.example](C:\Users\User\Documents\x402 tools - synthr\server\Caddyfile.example) into `/etc/caddy/Caddyfile`, replace the placeholder domain and email, then reload:

```bash
sudo systemctl reload caddy
```

## 5. Verify Public HTTPS

```bash
curl https://yourdomain.com/health
curl https://yourdomain.com/
```

If that works, the next checks are:
- paid `POST /v1/cyber/stack-brief`
- paid `GET /v1/cyber/breaking`
- payment settlement to `PAY_TO_ADDRESS`

## 6. Mainnet Cutover

Only after public testnet verification:

```dotenv
NETWORK=eip155:8453
FACILITATOR_URL=YOUR_PRODUCTION_FACILITATOR
```

Then redeploy:

```bash
docker compose up -d --build
```

## 7. Operational Notes

- Use `docker compose ps` to inspect health.
- Use `docker logs -f synthr-cyber` for runtime errors.
- Keep the app bound to localhost and let Caddy handle the public edge.
- Add uptime monitoring on `/health` before listing on x402scan.
