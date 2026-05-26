[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root 'python-services\venv\Scripts\python.exe'

if (-not (Get-Command 'npm.cmd' -ErrorAction SilentlyContinue)) {
    throw 'Khong tim thay npm.cmd trong PATH.'
}

if (-not (Test-Path -LiteralPath $python)) {
    throw "Khong tim thay Python virtual environment: $python"
}

function Test-PortListening {
    param([int]$Port)

    return $null -ne (
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
    )
}

function Start-DevTerminal {
    param(
        [string]$Title,
        [string]$Directory,
        [string]$Command,
        [int]$Port
    )

    if (Test-PortListening -Port $Port) {
        Write-Warning "$Title not started: port $Port is already listening."
        return
    }

    $escapedTitle = $Title.Replace("'", "''")
    $escapedDirectory = $Directory.Replace("'", "''")
    $terminalCommand = @"
`$Host.UI.RawUI.WindowTitle = '$escapedTitle'
Set-Location -LiteralPath '$escapedDirectory'
$Command
"@
    $encodedCommand = [Convert]::ToBase64String(
        [System.Text.Encoding]::Unicode.GetBytes($terminalCommand)
    )

    Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoExit', '-EncodedCommand', $encodedCommand) `
        -WorkingDirectory $Directory

    Write-Host "Started $Title on port $Port"
}

$escapedPython = $python.Replace("'", "''")

Start-DevTerminal `
    -Title 'KLTN Backend' `
    -Directory (Join-Path $root 'backend-kltn') `
    -Command 'npm.cmd run dev' `
    -Port 3000

Start-DevTerminal `
    -Title 'KLTN Frontend' `
    -Directory (Join-Path $root 'frontend-kltn') `
    -Command 'npm.cmd run dev' `
    -Port 5173

Start-DevTerminal `
    -Title 'KLTN CSV2Graph Sidecar' `
    -Directory (Join-Path $root 'python-services') `
    -Command "& '$escapedPython' -m uvicorn csvtograph_sidecar:app --host 127.0.0.1 --port 8002" `
    -Port 8002

Start-DevTerminal `
    -Title 'KLTN GNN Inference' `
    -Directory (Join-Path $root 'python-services') `
    -Command "& '$escapedPython' -m uvicorn gnn_service:app --host 127.0.0.1 --port 8001" `
    -Port 8001

Write-Host ''
Write-Host 'Local services requested: frontend :5173, backend :3000, GNN :8001, CSV2Graph :8002.'
Write-Host 'Text2Cypher Colab/ngrok is separate and must be started in Google Colab when needed.'
