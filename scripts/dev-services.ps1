# Starts the local services a Windows development build needs, each as its own
# background process (they keep running after this window closes):
#   Postgres 17 (5432), Garnet / Redis-compatible (6379), the relay (3000),
#   and the desktop frontend dev server (1420). Anything already running is
#   skipped.
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev-services.ps1
#
# Postgres and Garnet are portable installs in a services folder outside the
# repo: KH_SERVICES_DIR (default: ..\kenns-harness-services next to the repo),
# laid out as pgsql\ (Postgres binaries), pgdata\ (an initialized cluster) and
# garnet\net10.0\GarnetServer.exe. Logs are written there too. The relay reads
# its settings from the repo's .env (copy .env.example) and must be built
# first (cargo build -p buzz-relay).

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$S = if ($env:KH_SERVICES_DIR) { $env:KH_SERVICES_DIR } else { Join-Path (Split-Path -Parent $Repo) 'kenns-harness-services' }

function Listening($port) {
  # Vite binds ::1 and the other services 127.0.0.1, so probe both. A plain
  # TcpClient in Windows PowerShell is IPv4-only, hence one socket per family.
  foreach ($probe in @(@('InterNetwork', '127.0.0.1'), @('InterNetworkV6', '::1'))) {
    $client = New-Object System.Net.Sockets.TcpClient([System.Net.Sockets.AddressFamily]$probe[0])
    try { if ($client.ConnectAsync($probe[1], $port).Wait(500) -and $client.Connected) { return $true } }
    catch { }
    finally { $client.Dispose() }
  }
  $false
}
function WaitFor($port, $name) {
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Listening $port)) {
    if ((Get-Date) -gt $deadline) { throw "$name did not start on port $port" }
    Start-Sleep 1
  }
  Write-Host "$name ready on $port"
}

if (-not (Listening 5432)) {
  Start-Process "$S\pgsql\bin\pg_ctl.exe" -ArgumentList @('-D', "`"$S\pgdata`"", '-l', "`"$S\postgres.log`"", 'start') -WindowStyle Hidden
  WaitFor 5432 'Postgres'
} else { Write-Host 'Postgres already running' }

if (-not (Listening 6379)) {
  Start-Process "$S\garnet\net10.0\GarnetServer.exe" -ArgumentList '--bind 127.0.0.1 --port 6379 --lua -m 256m' `
    -WindowStyle Hidden -RedirectStandardOutput "$S\garnet.log" -RedirectStandardError "$S\garnet.err.log"
  WaitFor 6379 'Garnet'
} else { Write-Host 'Garnet already running' }

if (-not (Listening 3000)) {
  foreach ($line in Get-Content "$Repo\.env") {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"'), 'Process')
    }
  }
  $env:BUZZ_BIND_ADDR = '127.0.0.1:3000'      # local only, not the LAN
  $env:BUZZ_GIT_CONFORMANCE_PROBE = 'false'   # needs S3 (MinIO), which isn't run here
  Start-Process "$Repo\target\debug\buzz-relay.exe" -WorkingDirectory $Repo -WindowStyle Hidden `
    -RedirectStandardOutput "$S\relay.log" -RedirectStandardError "$S\relay.err.log"
  WaitFor 3000 'Relay'
} else { Write-Host 'Relay already running' }

if (-not (Listening 1420)) {
  Start-Process "$Repo\desktop\node_modules\.bin\vite.cmd" -ArgumentList '--port 1420 --strictPort' `
    -WorkingDirectory "$Repo\desktop" -WindowStyle Hidden `
    -RedirectStandardOutput "$S\vite.log" -RedirectStandardError "$S\vite.err.log"
  WaitFor 1420 'Dev server'
} else { Write-Host 'Dev server already running' }
