# PowerShell test script for help commands
# Run this in native PowerShell (not bash)

Write-Host "Testing prompd --help..." -ForegroundColor Cyan
prompd --help

Write-Host "`n`nTesting prompd pack --help..." -ForegroundColor Cyan
prompd pack --help

Write-Host "`n`nTesting prompd config --help..." -ForegroundColor Cyan
prompd config --help

Write-Host "`n`nTesting prompd package --help..." -ForegroundColor Cyan
prompd package --help

Write-Host "`n`nTesting prompd --version..." -ForegroundColor Cyan
prompd --version
