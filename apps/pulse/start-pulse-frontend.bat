@echo off
echo Starting Pulse frontend dev server (Vite on :5000, proxies to Rust backend :3457)...
echo See PULSE_ACTUALIZATION_PLAN.md for full current run instructions and Phase 0 status.
cd /d "%~dp0\frontend"
pnpm install
pnpm exec vite
pause