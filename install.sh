#!/bin/bash
# Prompd CLI Installer Script

set -e

# Configuration
REPO="Logikbug/prompt-markdown"
BINARY_NAME="prompd"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case $ARCH in
    x86_64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Get latest release
echo "🔍 Finding latest release..."
LATEST_URL="https://api.github.com/repos/$REPO/releases/latest"
RELEASE_INFO=$(curl -s $LATEST_URL)
VERSION=$(echo $RELEASE_INFO | grep -o '"tag_name": "[^"]*' | cut -d'"' -f4)

if [ -z "$VERSION" ]; then
    echo "❌ Could not determine latest version"
    exit 1
fi

echo "📦 Latest version: $VERSION"

# Download URL
if [ "$OS" = "darwin" ]; then
    PLATFORM="darwin"
elif [ "$OS" = "linux" ]; then
    PLATFORM="linux"
else
    echo "❌ Unsupported platform: $OS"
    exit 1
fi

ARCHIVE_NAME="prompd-${PLATFORM}-${ARCH}.tar.gz"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/$ARCHIVE_NAME"

echo "⬇️  Downloading $ARCHIVE_NAME..."

# Create temp directory
TMP_DIR=$(mktemp -d)
cd $TMP_DIR

# Download and extract
curl -sL "$DOWNLOAD_URL" -o "$ARCHIVE_NAME"
tar -xzf "$ARCHIVE_NAME"

# Install
echo "📦 Installing to $INSTALL_DIR..."
sudo mv "prompd-${PLATFORM}-${ARCH}" "$INSTALL_DIR/$BINARY_NAME"
sudo chmod +x "$INSTALL_DIR/$BINARY_NAME"

# Cleanup
rm -rf $TMP_DIR

echo "✅ Prompd CLI installed successfully!"
echo "🚀 Try: $BINARY_NAME --help"