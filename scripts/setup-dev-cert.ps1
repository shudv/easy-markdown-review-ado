# Generate a locally-trusted self-signed certificate for the webpack-dev-server
# HTTPS endpoint at https://localhost:3000.
#
# Why this exists: ADO sandboxes the PR-tab iframe over HTTPS, so the dev
# server must speak HTTPS. The webpack-dev-server auto-generated cert is
# untrusted; this script issues a real cert, exports it as a PFX bundle
# webpack consumes directly, and installs the public cert in the current
# user's Trusted Root store so browsers stop showing the "Not secure" warning.
#
# Idempotent: if a cert with the same friendly name + DnsName already exists
# and isn't expired, the script reuses it. Run with -Force to recreate.
#
# Usage:
#   pwsh -File scripts/setup-dev-cert.ps1
#   pwsh -File scripts/setup-dev-cert.ps1 -Force
#
# No admin rights required (uses CurrentUser store on both ends).

param(
    [switch] $Force
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$certsDir = Join-Path $repoRoot 'certs'
if (!(Test-Path $certsDir)) { New-Item -ItemType Directory -Path $certsDir | Out-Null }

$friendly = 'easy-markdown-review localhost dev'
$pfxPath = Join-Path $certsDir 'localhost.pfx'
$pfxPasswordPath = Join-Path $certsDir 'localhost.pfx.password'

# Reuse existing valid cert unless -Force.
$existing = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.FriendlyName -eq $friendly -and $_.NotAfter -gt (Get-Date) } |
    Select-Object -First 1

if ($existing -and -not $Force -and (Test-Path $pfxPath) -and (Test-Path $pfxPasswordPath)) {
    Write-Host ("Reusing existing cert (thumbprint={0}, NotAfter={1})." -f $existing.Thumbprint, $existing.NotAfter) -ForegroundColor Green
    Write-Host ("PFX:      {0}" -f $pfxPath)
    Write-Host ("Password: {0}" -f $pfxPasswordPath)
    return
}

if ($existing -and $Force) {
    Write-Host "Removing existing cert (-Force given)..."
    Remove-Item ("Cert:\CurrentUser\My\{0}" -f $existing.Thumbprint) -Force
    $rootDup = Get-ChildItem Cert:\CurrentUser\Root |
        Where-Object { $_.Thumbprint -eq $existing.Thumbprint } |
        Select-Object -First 1
    if ($rootDup) {
        Remove-Item ("Cert:\CurrentUser\Root\{0}" -f $rootDup.Thumbprint) -Force
    }
}

Write-Host "Generating new self-signed cert for localhost..."

$cert = New-SelfSignedCertificate `
    -Subject 'CN=localhost' `
    -DnsName 'localhost', '127.0.0.1' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -KeyExportPolicy Exportable `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -KeySpec Signature `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -NotAfter (Get-Date).AddYears(3) `
    -FriendlyName $friendly `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.1')

Write-Host ("  thumbprint: {0}" -f $cert.Thumbprint)
Write-Host ("  not after:  {0}" -f $cert.NotAfter)

# Random per-machine PFX password so the file is mildly inert at rest.
$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$password = [Convert]::ToBase64String($bytes)
$securePassword = ConvertTo-SecureString -String $password -Force -AsPlainText

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword | Out-Null
Set-Content -Path $pfxPasswordPath -Value $password -NoNewline

# Trust the cert in the CurrentUser Trusted Root store (no admin).
$rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
$rootStore.Open('ReadWrite')
$rootStore.Add($cert)
$rootStore.Close()

Write-Host "Installed into Cert:\CurrentUser\Root (trusted)."
Write-Host ""
Write-Host ("PFX:      {0}" -f $pfxPath) -ForegroundColor Green
Write-Host ("Password: {0}" -f $pfxPasswordPath) -ForegroundColor Green
Write-Host ""
Write-Host "Done. Restart `npm run dev:https` to pick up the new cert."
