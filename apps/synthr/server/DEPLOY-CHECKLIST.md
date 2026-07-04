# VPS Deployment Checklist

Use this checklist after local validation to move Synthr Cyber onto a VPS in the order described by the project docs.

## 1. Local Readiness

- [ ] Copy `.env.example` to `.env`.
- [ ] Set a real `PAY_TO_ADDRESS`.
- [ ] Start on testnet first:
  - `FACILITATOR_URL=https://x402.org/facilitator`
  - `NETWORK=eip155:84532`
- [ ] Set `CORS_ORIGIN` to `*` only for local testing. Use your real frontend/domain before public deployment.
- [ ] Run `npm install`
- [ ] Run `npm run typecheck`
- [ ] Run `npx tsx test-local.ts`

## 2. Docker Verification

- [ ] Build locally: `docker build -t synthr-cyber .`
- [ ] Start locally: `docker compose up --build`
- [ ] Verify health: `curl http://localhost:3000/health`
- [ ] Verify discovery:
  - `curl http://localhost:3000/`
  - `curl http://localhost:3000/llms.txt`
  - `curl http://localhost:3000/x402-catalog.json`
  - `curl http://localhost:3000/openapi.json`

## 3. VPS Provisioning

- [ ] Provision Ubuntu or Debian VPS.
- [ ] Install Docker and Docker Compose support.
- [ ] Clone repo onto VPS.
- [ ] Copy `.env.example` to `.env`.
- [ ] Follow [UBUNTU-24.04-DEPLOY.md](./UBUNTU-24.04-DEPLOY.md) if this is landing on Ubuntu 24.04.
- [ ] Set production-safe values:
  - `BIND_HOST=127.0.0.1`
  - `CORS_ORIGIN=https://yourdomain.com`
  - `PUBLIC_BASE_URL=https://synthr.online`
  - `LOG_LEVEL=info`
  - `PORT=3000`
- [ ] Keep testnet first until the full payment flow is verified publicly.

## 4. Public Deployment

- [ ] Start container: `docker compose up -d --build`
- [ ] Check logs: `docker logs synthr-cyber --tail 100`
- [ ] Verify health on VPS IP: `curl http://YOUR_VPS_IP:3000/health`
- [ ] Put a reverse proxy in front of the app:
  - Caddy recommended by project docs
  - Nginx acceptable alternative
- [ ] Use [Caddyfile.example](./Caddyfile.example) as the starting point when using Caddy.
- [ ] Verify HTTPS endpoint once proxy is live.

## 5. Production Hardening

- [ ] Tighten `CORS_ORIGIN` to the exact public origin.
- [ ] Review `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` for public traffic.
- [ ] Switch from testnet to Base mainnet only after public verification.
- [ ] Fund the receiving wallet for real settlement testing.
- [ ] Add uptime monitoring against `/health`.
- [ ] Review dependency vulnerabilities with `npm audit`.
- [ ] Decide whether to add rate limiting before public listing.

## 6. Discovery Readiness

- [ ] Confirm `/llms.txt` is serving correctly.
- [ ] Confirm `/x402-catalog.json` is serving correctly.
- [ ] Confirm `/openapi.json` is serving correctly.
- [ ] Confirm root `/` advertises the right domain, pricing, and network.
- [ ] Register on x402scan after the public endpoint is stable.

## 7. Post-Deploy Smoke Tests

- [ ] Run a paid call against `POST /v1/cyber/stack-brief`.
- [ ] Run a paid call against `GET /v1/cyber/breaking`.
- [ ] Confirm response latency and healthcheck stability.
- [ ] Confirm payment settlement to `PAY_TO_ADDRESS`.
