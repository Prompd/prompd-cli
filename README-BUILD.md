# Building Prompd CLI

## Prerequisites

Install Go 1.20 or later from https://golang.org/dl/

## Build Instructions

### Build for Current Platform
```bash
cd cli/prompd/go
go mod tidy
go build -o prompd ./cmd/prompd
```

### Build for All Platforms
From the root directory:
```bash
# Linux/macOS
./build.sh

# Windows
build.bat
```

Binaries will be created in the `dist/` folder:
- `prompd-windows-amd64.exe` - Windows 64-bit
- `prompd-linux-amd64` - Linux 64-bit  
- `prompd-darwin-amd64` - macOS Intel
- `prompd-darwin-arm64` - macOS Apple Silicon

## Testing the Build

After building:
```bash
# Validate a .prompd file
./prompd validate examples/basic/example.prompd

# List .prompd files
./prompd list examples/

# Show file structure
./prompd show examples/basic/example.prompd

# Execute with demo mode
./prompd execute examples/basic/example.prompd --provider openai --model gpt-4 -p name=Alice --demo
```

## Troubleshooting

If you get module errors:
```bash
cd cli/prompd/go
go mod download
go mod tidy
```

If you get permission errors on Linux/macOS:
```bash
chmod +x prompd
```

## Directory Structure
```
cli/prompd/go/
├── go.mod          # Module definition
├── go.sum          # Dependency checksums  
├── cmd/
│   └── prompd/
│       ├── main.go      # Entry point
│       ├── parser.go    # .prompd file parser
│       ├── commands.go  # CLI commands
│       └── llm.go       # LLM integrations
```