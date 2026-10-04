param(
  [string]$FilePath,
  [string]$Folder,
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Windows signing and verification require a Windows runner.' }
if (($FilePath -and $Folder) -or (-not $FilePath -and -not $Folder)) {
  throw 'Choose exactly one file or application folder.'
}
if ($FilePath) {
  $files = @(Get-Item -LiteralPath $FilePath)
} else {
  $files = @(Get-ChildItem -LiteralPath $Folder -File -Recurse | Where-Object {
    $_.Extension.ToLowerInvariant() -in @('.exe', '.dll', '.node')
  })
}
if ($files.Count -eq 0) { throw 'No executable files were found to verify.' }
if ($env:PRISM_REQUIRE_SIGNED_RELEASE -eq 'true' -and [string]::IsNullOrWhiteSpace($env:PRISM_WINDOWS_EXPECTED_PUBLISHER)) {
  throw 'A published Windows release requires PRISM_WINDOWS_EXPECTED_PUBLISHER.'
}
foreach ($file in $files) {
  if ($file.PSIsContainer) { throw 'Expected a regular executable file.' }
}

if (-not $VerifyOnly) {
  foreach ($name in @('PRISM_WINDOWS_SIGNING_ENDPOINT', 'PRISM_WINDOWS_SIGNING_ACCOUNT', 'PRISM_WINDOWS_CERTIFICATE_PROFILE')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
      throw "Missing signing setting: $name"
    }
  }
  # The official Azure/artifact-signing-action installs this module. Azure CLI
  # authentication comes from azure/login using the release environment's OIDC
  # credential; no private certificate or client-secret command is needed.
  Import-Module ArtifactSigning -ErrorAction Stop
  foreach ($file in $files) {
    Invoke-ArtifactSigning -Endpoint $env:PRISM_WINDOWS_SIGNING_ENDPOINT `
      -CodeSigningAccountName $env:PRISM_WINDOWS_SIGNING_ACCOUNT `
      -CertificateProfileName $env:PRISM_WINDOWS_CERTIFICATE_PROFILE `
      -Files $file.FullName -FileDigest SHA256 `
      -TimestampRfc3161 'http://timestamp.acs.microsoft.com' -TimestampDigest SHA256 `
      -ExcludeEnvironmentCredential $true -ExcludeManagedIdentityCredential $true `
      -ExcludeWorkloadIdentityCredential $true -ExcludeAzureCliCredential $false
  }
}

foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
    throw "The Authenticode signature is not trusted: $($file.Name) ($($signature.Status))"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "The Authenticode signature has no timestamp: $($file.Name)"
  }
  if ($env:PRISM_WINDOWS_EXPECTED_PUBLISHER -and $signature.SignerCertificate.Subject -ne $env:PRISM_WINDOWS_EXPECTED_PUBLISHER) {
    throw "The signing publisher does not match the configured identity: $($file.Name)"
  }
  Write-Output "Verified signed file: $($file.Name)"
}
