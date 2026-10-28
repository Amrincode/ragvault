param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root 'backend/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    [Console]::Error.WriteLine('Backend venv missing. From the repository root run: python -m venv backend/.venv; then install ./backend[dev].')
    exit 1
}
$command = if ($CheckOnly) { 'preflight' } else { 'start' }
Push-Location (Join-Path $root 'backend')
try {
    & $python -m app.dev $command
    $result = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $result
