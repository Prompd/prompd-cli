#!/bin/bash
echo "Building prompd Go CLI for multiple platforms..."

cd cli/prompd/go
mkdir -p ../../../dist

echo "Building for Windows (amd64)..."
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w" -o ../../../dist/prompd-windows-amd64.exe ./cmd/prompd

echo "Building for Linux (amd64)..."
GOOS=linux GOARCH=amd64 go build -ldflags "-s -w" -o ../../../dist/prompd-linux-amd64 ./cmd/prompd

echo "Building for macOS (amd64)..."
GOOS=darwin GOARCH=amd64 go build -ldflags "-s -w" -o ../../../dist/prompd-darwin-amd64 ./cmd/prompd

echo "Building for macOS (arm64)..."
GOOS=darwin GOARCH=arm64 go build -ldflags "-s -w" -o ../../../dist/prompd-darwin-arm64 ./cmd/prompd

cd ../../..

echo ""
echo "Build complete! Binaries in dist/ folder:"
ls -la dist/
echo ""
echo "These are standalone binaries with zero runtime dependencies."
echo "Copy any binary to a target system and run directly."