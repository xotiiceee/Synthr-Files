# Capture verif evidence using ONLY vitest runs (per strategy)
param()
$SCRATCH = "C:\Users\Josh\AppData\Local\Temp\grok-goal-1cda7b73c6c5\implementer"
Write-Host "Capturing to $SCRATCH using vitest only..."

# Use arg array splat for --exclude to avoid PS/cmd quoting/mangling issues
$excludeArgs = @()
if ($IsWindows -or ($env:OS -match 'Windows')) {
  $excludeArgs = @("--exclude", "**/backup-production.unix.test.ts")
}
npx vitest run @excludeArgs 2>&1 | Tee-Object -FilePath "$SCRATCH/verif-npm-test.log"

npx vitest run tests/core/gateway-knowledge.test.ts --reporter=verbose 2>&1 | Tee-Object -FilePath "$SCRATCH/verif-step3.log"

Write-Host "Done."
