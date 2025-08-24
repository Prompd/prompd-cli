# Prompd CLI Windows Installer Script

param(
    [string]$InstallDir = "$env:LOCALAPPDATA\prompd",
    [switch]$AddToPath
)

$ErrorActionPreference = "Stop"

# Configuration
$REPO = "Logikbug/prompt-markdown"
$BINARY_NAME = "prompd.exe"

# Detect architecture
$ARCH = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "386" }

Write-Host "🔍 Finding latest release..." -ForegroundColor Cyan

# Get latest release
$LATEST_URL = "https://api.github.com/repos/$REPO/releases/latest"
try {
    $releaseInfo = Invoke-RestMethod -Uri $LATEST_URL
    $VERSION = $releaseInfo.tag_name
    Write-Host "📦 Latest version: $VERSION" -ForegroundColor Green
} catch {
    Write-Host "❌ Could not determine latest version" -ForegroundColor Red
    exit 1
}

# Download URL
$ARCHIVE_NAME = "prompd-windows-${ARCH}.zip"
$DOWNLOAD_URL = "https://github.com/$REPO/releases/download/$VERSION/$ARCHIVE_NAME"

Write-Host "⬇️  Downloading $ARCHIVE_NAME..." -ForegroundColor Yellow

# Create install directory
if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Create temp directory
$TMP_DIR = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_ }

try {
    # Download and extract
    $archivePath = Join-Path $TMP_DIR $ARCHIVE_NAME
    Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $archivePath
    
    Expand-Archive -Path $archivePath -DestinationPath $TMP_DIR -Force
    
    # Install
    Write-Host "📦 Installing to $InstallDir..." -ForegroundColor Cyan
    $sourceBinary = Join-Path $TMP_DIR "prompd-windows-${ARCH}.exe"
    $targetBinary = Join-Path $InstallDir $BINARY_NAME
    
    Copy-Item $sourceBinary $targetBinary -Force
    
    Write-Host "✅ Prompd CLI installed successfully!" -ForegroundColor Green
    
    # Add to PATH if requested
    if ($AddToPath) {
        $currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
        if ($currentPath -notlike "*$InstallDir*") {
            [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$InstallDir", "User")
            Write-Host "📝 Added $InstallDir to your PATH" -ForegroundColor Green
            Write-Host "   Please restart your terminal to use 'prompd' command" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   To add to PATH permanently, run with -AddToPath flag" -ForegroundColor Gray
    }
    
    Write-Host "🚀 Try: $targetBinary --help" -ForegroundColor Cyan
    
} finally {
    # Cleanup
    Remove-Item $TMP_DIR -Recurse -Force
}