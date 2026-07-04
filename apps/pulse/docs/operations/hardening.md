# Pulse VPS Hardening

Status: canonical


This is the recommended production layout for running the hosted Pulse service on a Linux VPS with `systemd` while keeping secrets out of the repo checkout and reducing the blast radius of bad commands.

## Target Architecture

- SSH access uses keys only.
- Root SSH login is disabled.
- A dedicated `deploy` user owns the repo checkout and runs deployments.
- The hosted service runs as `deploy` unless you later split to a narrower runtime user.
- Production secrets live outside the repo at `/etc/pulse/pulse.env`.
- `systemd` owns process restarts, logs, and boot-time startup.
- The host firewall allows only SSH, HTTP, and HTTPS unless another port is truly needed.

## Host Layout

```text
/home/deploy/pulse         repo checkout
/etc/pulse/pulse.env       production secrets
/var/log/journal           service logs via journald
```

## Why This Helps

- Editors, shells, and assistants work mostly in the repo checkout, not the secret directory.
- A compromised app process does not automatically imply root access.
- Deploys stay repeatable because service install, restart, and health checks are scripted.
- Recovery is faster because logs and startup are standardized under `systemd`.

## Secret Storage

Preferred production env file:

```text
/etc/pulse/pulse.env
```

Permissions:

```bash
sudo mkdir -p /etc/pulse
sudo touch /etc/pulse/pulse.env
sudo chown root:root /etc/pulse/pulse.env
sudo chmod 600 /etc/pulse/pulse.env
```

Keep sensitive values such as `TENANT_ENCRYPTION_KEY`, `GROQ_API_KEY`, `SERPER_API_KEY`, OAuth secrets, and any platform tokens in that file, not in the checkout.

## Systemd Runtime

Pulse is designed to run as a long-lived hosted service:

- unit file: `scripts/pulse-hosted.service`
- deploy command: `bash scripts/deploy.sh`
- logs: `journalctl -u pulse-hosted -f`

The service file in this repo now reads from `/etc/pulse/pulse.env`.
The deploy script now defaults to the branch already checked out on the server,
validates the target branch name, allows only `master` or `main` by default,
blocks dirty deploys unless `ALLOW_DIRTY=1`, rejects branch switching from
`AUTO_SWITCH_BRANCH=1` unless `ALLOW_DEPLOY_BRANCH_SWITCH=1` is also set for a
reviewed manual deploy, fails before restart when `/etc/pulse/pulse.env` is
missing, and writes `hosted/deploy-meta.json` so `/health` can report the active
branch, commit, and UI bundle. After restart, the deploy script verifies
`/api/deploy-info` reports the just-deployed branch and commit before it reports
success.

## SSH Hardening

Recommended `sshd` settings:

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
ChallengeResponseAuthentication no
X11Forwarding no
AllowUsers deploy
```

Always verify a second SSH session works before closing the first one.

## Firewall

Allow only:

- `22/tcp` for SSH
- `80/tcp` for HTTP
- `443/tcp` for HTTPS

If Pulse is only reverse-proxied locally, do not expose port `3457` publicly.

## Protection Against Malicious Commands

There is no perfect prevention layer, but this is the practical modern baseline:

- do not run Pulse as root
- keep secrets out of the repo checkout
- restrict `sudo`
- keep `DEPLOY_BRANCH_ALLOWLIST` pinned to protected release branches; set
  `ALLOW_UNLISTED_DEPLOY_BRANCH=1` only for a reviewed manual deploy
- use passphrase-protected SSH keys
- disable password auth
- enable `fail2ban`
- keep firewall rules narrow
- use `systemd` for logs and restart behavior
- back up important tenant data before large changes

For even stronger isolation, consider AppArmor, SELinux, or moving especially sensitive secrets to a dedicated secret manager later.

## Rollout Order

1. Create `deploy` user and install SSH keys
2. Disable password SSH auth and root SSH login
3. Turn on the firewall
4. Create `/etc/pulse/pulse.env`
5. Move the repo to `/home/deploy/pulse`
6. Install the `pulse-hosted` systemd unit
7. Run the deploy script and verify health

## Verification Checklist

```bash
ssh deploy@your-vps
sudo ss -tulpn
sudo ufw status
sudo fail2ban-client status sshd
ls -l /etc/pulse/pulse.env
cd /home/deploy/pulse
bash scripts/deploy.sh
systemctl status pulse-hosted --no-pager
journalctl -u pulse-hosted --no-pager -n 50
curl -I http://localhost:3457/health
curl http://localhost:3457/api/deploy-info
```
