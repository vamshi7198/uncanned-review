# Create .env from .env.example with freshly generated secrets.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (Test-Path .env) { Write-Error ".env already exists; not overwriting." }
function New-Secret {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $_.ToString("x2") })
}
$token = New-Secret
(Get-Content .env.example) `
  -replace '^POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$(New-Secret)" `
  -replace '^BOOTSTRAP_TOKEN=.*', "BOOTSTRAP_TOKEN=$token" |
  Set-Content -Encoding utf8 .env
Write-Host "Created .env. Your setup token (needed once, at /setup):"
Write-Host $token
