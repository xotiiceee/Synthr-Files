# Phase 0 Dev Starter for Pulse (split app)
# Run from pulse root in PowerShell

Write-Host "Pulse Dev Start (see PULSE_ACTUALIZATION_PLAN.md)" -ForegroundColor Green

Write-Host "1. Starting docker services (Postgres + Qdrant)..." -ForegroundColor Cyan
Push-Location backend
docker compose up -d
Pop-Location

Write-Host "2. Reminder: In separate terminals run:"
Write-Host "   cd backend; cargo run"
Write-Host "   cd frontend; pnpm dev"
Write-Host ""
Write-Host "3. Open http://localhost:5000 (add ?demo=true if needed for session)"
Write-Host "4. Backend on 3457 with demo data and cost-aware intel"
Write-Host ""
Write-Host "Cleanup and stubs are in Phase 0 per plan. Full Next.js + Temporal in later phases." -ForegroundColor Yellow

Read-Host "Press enter when ready (services starting in bg)"