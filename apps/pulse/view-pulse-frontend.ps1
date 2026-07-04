# Pulse Frontend Viewer (local dev helper)
# Run this from the pulse folder. See PULSE_ACTUALIZATION_PLAN.md for full Phase 0 status.

Write-Host "Starting Pulse frontend dev..." -ForegroundColor Green
Write-Host "Frontend: frontend/ (Vite). Backend must be running on :3457 (cargo run in backend/ or docker)." -ForegroundColor Cyan
Write-Host "Demo mode: session will auto-use ?demo=true for local auth." -ForegroundColor Yellow

Set-Location -Path "$PSScriptRoot\frontend"

pnpm install
Start-Process -FilePath "pnpm" -ArgumentList "exec vite" -WindowStyle Normal

Write-Host ""
Write-Host "Dev server starting. Open http://localhost:5000 (or shown port)." -ForegroundColor Yellow
Write-Host "Use login or append ?demo=true to force demo session." -ForegroundColor Cyan
Write-Host "See the Actualization Plan for the roadmap to a real integrated experience." -ForegroundColor Green
Read-Host "Press Enter to close helper"