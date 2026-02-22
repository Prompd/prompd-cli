# Prompd Go CLI - Standalone Runtime-Free Implementation

This is a standalone Go implementation of the Prompd CLI that compiles to a single binary with zero runtime dependencies.

## Features

- **Zero Dependencies**: Single executable, no Python/Node.js/runtime required
- **Cross-Platform**: Windows, Linux, macOS (Intel & Apple Silicon)
- **Fast**: Native binary performance
- **Portable**: Drop the binary anywhere and run

## Installation

### Option 1: Download Pre-built Binary
Download the appropriate binary from releases and place it in your PATH.

### Option 2: Build from Source

1. Install Go 1.21+ from https://golang.org/dl/
2. Build for your platform:

```bash
# Build for current platform
go build -o prompd ./cmd/prompd

# Or build for all platforms
./build.sh    # Linux/macOS
build.bat     # Windows
```

Binaries will be in the `dist/` folder.

## Usage

```bash
# Validate a .prmd file
./prompd validate example.prmd

# List all .prmd files
./prompd list prompts/

# Show file structure
./prompd show example.prmd

# Execute (demo mode)
./prompd execute example.prmd --provider openai --model gpt-4 -p name=Alice

# Show version
./prompd version
```

## Binary Sizes

The standalone binaries are approximately 6-8MB and include:
- YAML parser
- File system operations
- Complete CLI functionality
- No external dependencies

## Deployment

Simply copy the binary to any machine:

```bash
# Linux/macOS
cp dist/prompd-linux-amd64 /usr/local/bin/prompd

# Windows
copy dist\prompd-windows-amd64.exe C:\tools\prompd.exe
```

No installation, package managers, or runtime setup required!