@echo off
echo Building prompd Go CLI for multiple platforms...

cd go
mkdir ..\dist 2>nul

echo Building for Windows (amd64)...
set GOOS=windows
set GOARCH=amd64
go build -ldflags "-s -w" -o ..\dist\prompd-windows-amd64.exe ./cmd/prompd

echo Building for Linux (amd64)...
set GOOS=linux
set GOARCH=amd64
go build -ldflags "-s -w" -o ..\dist\prompd-linux-amd64 ./cmd/prompd

echo Building for macOS (amd64)...
set GOOS=darwin
set GOARCH=amd64
go build -ldflags "-s -w" -o ..\dist\prompd-darwin-amd64 ./cmd/prompd

echo Building for macOS (arm64)...
set GOOS=darwin
set GOARCH=arm64
go build -ldflags "-s -w" -o ..\dist\prompd-darwin-arm64 ./cmd/prompd

echo Building for Linux (arm64)...
set GOOS=linux
set GOARCH=arm64
go build -ldflags "-s -w" -o ..\dist\prompd-linux-arm64 ./cmd/prompd

echo Building for Windows (arm64)...
set GOOS=windows
set GOARCH=arm64
go build -ldflags "-s -w" -o ..\dist\prompd-windows-arm64.exe ./cmd/prompd

cd ..

echo.
echo Build complete! Binaries in dist/ folder:
dir dist
echo.
echo These are standalone binaries with zero runtime dependencies.
echo Copy any binary to a target system and run directly.
