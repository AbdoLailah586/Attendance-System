$ErrorActionPreference='Stop'
$taskRepoRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRepoRoot

if(!(Get-Command node -ErrorAction SilentlyContinue)){throw 'Node.js is not installed or not on PATH.'}
if(!(Test-Path -LiteralPath (Join-Path $taskRepoRoot '.env'))){
  Write-Warning '.env is missing. DATABASE_URL and JWT_SECRET must be set there for the app to work (see .env.example).'
}
if(!(Test-Path -LiteralPath (Join-Path $taskRepoRoot 'node_modules'))){
  Write-Host 'node_modules missing; installing dependencies (npm ci)...'
  npm ci
  if($LASTEXITCODE -ne 0){throw 'npm ci failed.'}
}

Start-Job -ScriptBlock { Start-Sleep -Seconds 3; Start-Process 'http://localhost:3000' } | Out-Null
Write-Host 'Starting the local dev server at http://localhost:3000 (Ctrl+C to stop)...'
npm run dev
