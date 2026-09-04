$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$server = $null
$web = $null

function Stop-ProcessTree([System.Diagnostics.Process] $process) {
    if ($null -ne $process -and -not $process.HasExited) {
        & taskkill.exe /PID $process.Id /T /F *> $null
    }
}

try {
    Write-Host "Starting La Magia match server on http://localhost:8787 ..."
    $server = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev:server") `
        -WorkingDirectory $root -NoNewWindow -PassThru

    Start-Sleep -Seconds 2

    Write-Host "Starting La Magia web client on http://localhost:5173/lamagia/ ..."
    $web = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") `
        -WorkingDirectory $root -NoNewWindow -PassThru

    Write-Host ""
    Write-Host "Local test URLs:"
    Write-Host "  Web:    http://localhost:5173/lamagia/"
    Write-Host "  Health: http://localhost:8787/health"
    Write-Host ""
    Write-Host "Keep this window open while testing. Closing it stops both services."

    while (-not $web.HasExited -and -not $server.HasExited) {
        Start-Sleep -Milliseconds 500
        $web.Refresh()
        $server.Refresh()
    }
}
finally {
    Stop-ProcessTree $web
    Stop-ProcessTree $server
}
